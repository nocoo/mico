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
		await store.getBoard()

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

test('a state read cannot mix an old stateVersion with a new active canvas', async (t) => {
	const cluster = await startPostgres(t)
	if (!cluster) return
	const pool = new Pool({ connectionString: cluster.connectionString, max: 4 })
	const control = new Pool({ connectionString: cluster.connectionString, max: 2 })
	const tenantId = 'ten-snapshot'
	let secondId = ''
	let interleave = false
	const boards = new BoardStore({
		ownsSql: false,
		sql: createPostgresSql({
			pool: wrapPool(pool, async (text, state) => {
				if (
					!interleave ||
					!text.startsWith('SELECT active_canvas_id, state_version FROM tenants')
				) {
					return
				}
				state.findTenantReads += 1
				if (state.findTenantReads !== 2) return
				interleave = false
				// Between the readState reads of state_version and active_canvas_id,
				// another connection commits a canvas switch.
				await control.query(
					'UPDATE tenants SET active_canvas_id = $1, state_version = state_version + 1 WHERE id = $2',
					[secondId, tenantId],
				)
			}),
		}),
	})
	const store = boards.forTenant({ tenantId })
	try {
		const initial = await store.getState()
		const mainId = initial.activeCanvasId
		const second = await store.createCanvas('Second', true)
		secondId = second.canvas.id
		await store.activateCanvas(mainId)
		const baseline = await store.getState()
		assert.deepEqual(
			[baseline.stateVersion, baseline.activeCanvasId],
			[initial.stateVersion + 2, mainId],
		)

		interleave = true
		const mixed = await store.getState()
		assert.deepEqual([mixed.stateVersion, mixed.activeCanvasId], [baseline.stateVersion, mainId])
		const settled = await store.getState()
		assert.deepEqual(
			[settled.stateVersion, settled.activeCanvasId],
			[baseline.stateVersion + 1, secondId],
		)
	} finally {
		await boards.close()
		await pool.end()
		await control.end()
	}
})

test('concurrent canvas management on one tenant still succeeds', async (t) => {
	const cluster = await startPostgres(t)
	if (!cluster) return
	const first = new BoardStore({
		sql: createPostgresSql({ connectionString: cluster.connectionString }),
	})
	const second = new BoardStore({
		sql: createPostgresSql({ connectionString: cluster.connectionString }),
	})
	try {
		const tenant = { tenantId: 'ten-concurrent' }
		const stores = [first.forTenant(tenant), second.forTenant(tenant)]
		const baseline = await stores[0].getState()
		const created = await Promise.all(
			stores.map((store, index) => store.createCanvas(`Concurrent ${index}`, false)),
		)
		assert.deepEqual(
			created.map((result) => result.canvas.name),
			['Concurrent 0', 'Concurrent 1'],
		)
		const after = await stores[1].getState()
		assert.equal(after.stateVersion, baseline.stateVersion + 2)
		assert.equal(after.canvases.length, baseline.canvases.length + 2)
	} finally {
		await Promise.all([first.close(), second.close()])
	}
})

const DRAINED_RECT: Shape = {
	id: 'drained-rect',
	type: 'rectangle',
	x: 900,
	y: 0,
	w: 100,
	h: 100,
	color: '#00a2e1',
}

test('close drains an admitted concurrent transaction instead of failing it', async (t) => {
	const cluster = await startPostgres(t)
	if (!cluster) return
	const pool = new Pool({ connectionString: cluster.connectionString, max: 4 })
	let pausing = false
	let enteredPause: (() => void) | undefined
	let releasePause: (() => void) | undefined
	const entered = new Promise<void>((resolve) => {
		enteredPause = resolve
	})
	const boards = new BoardStore({
		sql: createPostgresSql({
			pool: wrapPool(pool, async (text) => {
				if (!pausing || !text.startsWith('UPDATE canvases SET revision')) return
				pausing = false
				enteredPause?.()
				await new Promise<void>((resolve) => {
					releasePause = resolve
				})
			}),
		}),
	})
	const store = boards.forTenant({ tenantId: 'ten-drain' })
	const state = await store.getState()
	try {
		pausing = true
		const applied = store.apply({
			operations: [{ type: 'create', shape: DRAINED_RECT }],
			canvasId: state.activeCanvasId,
		})
		await entered
		const closing = boards.close()
		releasePause?.()
		await applied
		await closing

		await assert.rejects(() => store.getState(), /BoardStore is closing/)
		await boards.close()

		const verify = new BoardStore({
			sql: createPostgresSql({ connectionString: cluster.connectionString }),
		})
		try {
			const verified = await verify.forTenant({ tenantId: 'ten-drain' }).getBoard()
			assert.ok(verified.shapes.some((shape) => shape.id === DRAINED_RECT.id))
		} finally {
			await verify.close()
		}
	} finally {
		await boards.close().catch(() => undefined)
	}
})
