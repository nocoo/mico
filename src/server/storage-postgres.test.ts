import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, type TestContext, test } from 'node:test'
import { Pool, type PoolClient } from 'pg'
import type { Shape } from '../shared/types.ts'
import { createPostgresSql, type PgClientLike, type PgPoolLike } from './sql-postgres.ts'
import { BoardStore } from './store.ts'

/**
 * PostgreSQL integration harness: a private throwaway cluster under a
 * `mico-*` temp directory, listening on a Unix socket only (no TCP, no
 * shared state with any existing database). Tests skip when server
 * binaries are unavailable.
 */

interface PgCluster {
	readonly connectionString: string
	stop(): void
}

function resolvePostgresBin(name: string): string | undefined {
	if (!spawnSync(name, ['--version']).error) return name
	for (const root of ['/opt/homebrew/opt', '/usr/lib/postgresql']) {
		let entries: string[] = []
		try {
			entries = readdirSync(root)
		} catch {
			continue
		}
		const versions = entries
			.filter((entry) => entry.startsWith('postgresql'))
			.sort()
			.reverse()
		for (const entry of versions) {
			const candidate = join(root, entry, 'bin', name)
			if (existsSync(candidate)) return candidate
		}
	}
	return undefined
}

let clusterPromise: Promise<PgCluster | undefined> | undefined

async function startPostgresCluster(): Promise<PgCluster | undefined> {
	const initdb = resolvePostgresBin('initdb')
	const pgCtl = resolvePostgresBin('pg_ctl')
	if (!initdb || !pgCtl) return undefined
	const directory = mkdtempSync(join(tmpdir(), 'mico-pg-'))
	const data = join(directory, 'data')
	const sockets = join(directory, 'sock')
	mkdirSync(sockets, { recursive: true })
	const initialized = spawnSync(initdb, [
		'-D',
		data,
		'-U',
		'mico',
		'--auth=trust',
		'--no-sync',
		'-E',
		'UTF8',
	])
	if (initialized.status !== 0) {
		throw new Error(`initdb failed: ${initialized.stderr}`)
	}
	const started = spawnSync(
		pgCtl,
		[
			'-D',
			data,
			'-w',
			'-l',
			join(directory, 'postgres.log'),
			'-o',
			`-k ${sockets} -c listen_addresses= -c unix_socket_permissions=0700`,
			'start',
		],
		{ encoding: 'utf8' },
	)
	if (started.status !== 0) {
		throw new Error(`pg_ctl start failed: ${started.stderr}`)
	}
	const admin = new Pool({ connectionString: `postgresql://mico@/postgres?host=${sockets}` })
	try {
		await admin.query('CREATE DATABASE micotest')
	} finally {
		await admin.end()
	}
	return {
		connectionString: `postgresql://mico@/micotest?host=${sockets}`,
		stop() {
			spawnSync(pgCtl, ['-D', data, '-m', 'immediate', '-w', 'stop'])
			rmSync(directory, { recursive: true, force: true })
		},
	}
}

async function startPostgres(t: TestContext): Promise<PgCluster | undefined> {
	clusterPromise ??= startPostgresCluster().catch((error: unknown) => {
		clusterPromise = undefined
		throw error
	})
	const cluster = await clusterPromise
	if (!cluster) t.skip('PostgreSQL server binaries are not available')
	return cluster
}

after(async () => {
	const cluster = await clusterPromise
	cluster?.stop()
})

interface HookState {
	findTenantReads: number
}

type PoolHook = (text: string, state: HookState) => Promise<void> | void

/** Wrap a real `pg.Pool` as a `PgPoolLike` with an inspectable per-query hook. */
function wrapPool(pool: Pool, hook: PoolHook): PgPoolLike {
	const runQuery = async (
		target: Pool | PoolClient,
		text: string,
		values: readonly unknown[] | undefined,
		state: HookState,
	) => {
		await hook(text, state)
		const result = await target.query(text, values as unknown[])
		return {
			rows: result.rows as Record<string, unknown>[],
			rowCount: result.rowCount ?? null,
		}
	}
	return {
		async query(text, values) {
			return runQuery(pool, text, values, { findTenantReads: 0 })
		},
		async connect(): Promise<PgClientLike> {
			const client = await pool.connect()
			const state: HookState = { findTenantReads: 0 }
			return {
				async query(text, values) {
					return runQuery(client, text, values, state)
				},
				release(err) {
					client.release(err)
				},
			}
		},
		async end() {
			await pool.end()
		},
	}
}

const LEGACY_SHAPES = [
	{
		id: 'legacy-widget',
		type: 'widget',
		x: 0,
		y: 0,
		w: 100,
		h: 100,
		color: '#5b5fc7',
		widget: 'todo',
	},
	{
		id: 'kept-rect',
		type: 'rectangle',
		x: 240,
		y: 0,
		w: 100,
		h: 100,
		color: '#5b5fc7',
	},
]

const COMMITTED_RECT: Shape = {
	id: 'committed-rect',
	type: 'rectangle',
	x: 600,
	y: 0,
	w: 100,
	h: 100,
	color: '#00a2e1',
}

test('a legacy normalizing read cannot erase a concurrently committed shape', async (t) => {
	const cluster = await startPostgres(t)
	if (!cluster) return
	const pool = new Pool({ connectionString: cluster.connectionString, max: 4 })
	let rewriteInterleaved = false
	const boards = new BoardStore({
		ownsSql: false,
		sql: createPostgresSql({
			pool: wrapPool(pool, async (text) => {
				if (!rewriteInterleaved || !/^UPDATE canvases SET shapes = /.test(text)) return
				rewriteInterleaved = false
				// While the normalizing read transaction sits between its read and
				// its rewrite, a second store commits a brand-new board revision.
				const writer = new BoardStore({
					sql: createPostgresSql({ connectionString: cluster.connectionString }),
				})
				try {
					await writer
						.forTenant({ tenantId: 'ten-legacy' })
						.apply({ operations: [{ type: 'create', shape: COMMITTED_RECT }] })
				} finally {
					await writer.close()
				}
			}),
		}),
	})
	const store = boards.forTenant({ tenantId: 'ten-legacy' })
	try {
		const before = await store.getState()
		await boards.sql.run(
			'UPDATE canvases SET shapes = ?, revision = 3 WHERE id = ? AND tenant_id = ?',
			[JSON.stringify(LEGACY_SHAPES), before.activeCanvasId, 'ten-legacy'],
		)

		rewriteInterleaved = true
		const migrated = await store.getBoard()
		assert.deepEqual(
			migrated.shapes.map((shape) => shape.id),
			['kept-rect'],
		)

		const after = await store.getBoard()
		assert.deepEqual(
			after.shapes.map((shape) => shape.id),
			['kept-rect', 'committed-rect'],
		)
		assert.equal(after.revision, 4)
	} finally {
		await boards.close()
		await pool.end()
	}
})
