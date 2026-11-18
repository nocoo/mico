import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createMemoryBlobStore, imageBlobKey } from './blob.ts'
import { createAzureBlobStore } from './blob-azure.ts'
import { createR2BlobStore, type R2BucketLike, signR2S3Request } from './blob-r2.ts'
import { rewritePgPlaceholders, splitSqlStatements } from './sql.ts'
import { createD1Sql, type D1DatabaseLike, type D1PreparedStatementLike } from './sql-d1.ts'
import { createPostgresSql, type PgClientLike, type PgPoolLike } from './sql-postgres.ts'
import { createBoardStoreFromEnv, resolveStorageBackend } from './storage.ts'
import { BoardStore } from './store.ts'

/**
 * In-memory SQLite-backed `PgPoolLike` simulator that verifies PostgreSQL
 * dialect expectations: `$1..$n` positional placeholders, `BYTEA` DDL,
 * `to_regclass($1)` table lookup, string `COUNT(*)`, and explicit `BEGIN`/`COMMIT`/`ROLLBACK`.
 */
function createFakePgPool(): {
	pool: PgPoolLike
	queries: string[]
	txCalls: string[]
	closed: () => boolean
} {
	const db = new DatabaseSync(':memory:')
	const queries: string[] = []
	const txCalls: string[] = []
	let isClosed = false

	const toSqliteSql = (text: string): { sql: string; isCount: boolean } => {
		const normalized = text.replace(/\bBYTEA\b/gi, 'BLOB').replace(/\$(\d+)/g, '?')
		return {
			sql: normalized,
			isCount: /SELECT\s+COUNT\(\*\)\s+AS\s+count\b/i.test(text),
		}
	}

	const runQuery = (text: string, values: readonly unknown[] = []) => {
		queries.push(text)
		const trimmed = text.trim()
		if (/^BEGIN\b/.test(trimmed) || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
			txCalls.push(trimmed)
			db.exec(trimmed === 'BEGIN ISOLATION LEVEL REPEATABLE READ' ? 'BEGIN' : trimmed)
			return { rows: [], rowCount: 0 }
		}
		if (trimmed === 'SELECT to_regclass($1) AS name') {
			const row = db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
				.get(values[0] as string) as { name: string } | undefined
			return { rows: [{ name: row?.name ?? null }], rowCount: 1 }
		}
		if (!values.length && trimmed.includes(';')) {
			db.exec(toSqliteSql(trimmed).sql)
			return { rows: [], rowCount: 0 }
		}
		const { sql, isCount } = toSqliteSql(trimmed)
		const stmt = db.prepare(sql)
		if (/^(SELECT|WITH)\b/i.test(trimmed)) {
			const rows = stmt.all(...(values as never[])) as Record<string, unknown>[]
			if (isCount) {
				for (const row of rows) {
					if (row.count !== undefined) row.count = String(row.count)
				}
			}
			return { rows, rowCount: rows.length }
		}
		const result = stmt.run(...(values as never[]))
		return { rows: [], rowCount: Number(result.changes) }
	}

	const pool: PgPoolLike = {
		async query(text, values) {
			return runQuery(text, values)
		},
		async connect(): Promise<PgClientLike> {
			return {
				async query(text, values) {
					return runQuery(text, values)
				},
				release() {},
			}
		},
		async end() {
			isClosed = true
			db.close()
		},
	}

	return { pool, queries, txCalls, closed: () => isClosed }
}

function createFakeD1Database(): {
	db: D1DatabaseLike
	close: () => void
} {
	const sqlite = new DatabaseSync(':memory:')
	const makeStatement = (
		query: string,
		values: readonly unknown[] = [],
	): D1PreparedStatementLike => ({
		bind(...nextValues: readonly unknown[]) {
			return makeStatement(query, nextValues)
		},
		async first<T>() {
			const row = sqlite.prepare(query).get(...(values as never[]))
			return (row ?? null) as T | null
		},
		async all<T>() {
			const results = sqlite.prepare(query).all(...(values as never[])) as T[]
			return { results, meta: { changes: 0 } }
		},
		async run() {
			const res = sqlite.prepare(query).run(...(values as never[]))
			return { results: [], meta: { changes: Number(res.changes) } }
		},
	})

	return {
		db: {
			prepare(query) {
				return makeStatement(query)
			},
			async batch<T>(statements: readonly D1PreparedStatementLike[]) {
				const results = []
				for (const stmt of statements) {
					results.push(await stmt.all<T>())
				}
				return results
			},
		},
		close: () => sqlite.close(),
	}
}

function createFakeR2Bucket(): R2BucketLike {
	const store = new Map<string, { bytes: Uint8Array; contentType?: string }>()
	return {
		async put(key, value, options) {
			const bytes =
				typeof value === 'string'
					? new TextEncoder().encode(value)
					: value instanceof ArrayBuffer
						? new Uint8Array(value)
						: new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
			store.set(key, { bytes, contentType: options?.httpMetadata?.contentType })
		},
		async get(key) {
			const entry = store.get(key)
			if (!entry) return null
			return {
				httpMetadata: { contentType: entry.contentType },
				async arrayBuffer() {
					return entry.bytes.slice().buffer
				},
			}
		},
		async delete(key) {
			store.delete(key)
		},
	}
}

test('rewritePgPlaceholders rewrites unquoted ? while ignoring literals and comments', () => {
	const sql = [
		'SELECT \'?\' AS lit, "col?" FROM tbl -- comment ?',
		'/* block ? comment */ WHERE a = ? AND b = ?',
	].join('\n')
	assert.equal(
		rewritePgPlaceholders(sql),
		[
			'SELECT \'?\' AS lit, "col?" FROM tbl -- comment ?',
			'/* block ? comment */ WHERE a = $1 AND b = $2',
		].join('\n'),
	)
})

test('splitSqlStatements splits statements while preserving semicolons in quotes and comments', () => {
	const sql = `
		CREATE TABLE a (id TEXT DEFAULT 'x;y');
		-- ignore ;
		/* also ; ignore */
		CREATE TABLE b (id TEXT);
	`
	assert.deepEqual(splitSqlStatements(sql), [
		"CREATE TABLE a (id TEXT DEFAULT 'x;y')",
		'-- ignore ;\n\t\t/* also ; ignore */\n\t\tCREATE TABLE b (id TEXT)',
	])
})

test('PostgreSQL + Azure BlobStore supports full BoardStore lifecycle and tenant isolation', async () => {
	const fakePg = createFakePgPool()
	const remoteBlobs = new Map<string, { bytes: Uint8Array; contentType: string }>()
	const authHeaders: string[] = []

	const fakeFetch: typeof fetch = async (input, init) => {
		const url = String(input)
		const headers = (init?.headers ?? {}) as Record<string, string>
		authHeaders.push(headers.Authorization ?? '')
		assert.equal(headers['x-ms-version'], '2023-11-03')
		const key = decodeURIComponent(url.split('/mico-assets/')[1] ?? '')

		if (init?.method === 'PUT') {
			assert.equal(headers['x-ms-blob-type'], 'BlockBlob')
			const body = init.body as Uint8Array
			remoteBlobs.set(key, {
				bytes: new Uint8Array(body),
				contentType: headers['Content-Type'] ?? 'application/octet-stream',
			})
			return new Response(null, { status: 201 })
		}
		if (init?.method === 'GET') {
			const entry = remoteBlobs.get(key)
			if (!entry) return new Response('Not Found', { status: 404 })
			return new Response(Buffer.from(entry.bytes), {
				status: 200,
				headers: { 'content-type': entry.contentType },
			})
		}
		if (init?.method === 'DELETE') {
			const existed = remoteBlobs.delete(key)
			return new Response(null, { status: existed ? 202 : 404 })
		}
		return new Response(null, { status: 405 })
	}

	const sql = createPostgresSql({ pool: fakePg.pool })
	assert.equal(sql.dialect, 'postgres')
	assert.equal(sql.concurrent, true)

	const blobs = createAzureBlobStore({
		accountName: 'micotest',
		containerName: 'mico-assets',
		tokenProvider: async () => 'azure-token-123',
		fetch: fakeFetch,
	})

	const boards = new BoardStore({ sql, blobs })
	await boards.waitUntilReady()

	assert.ok(fakePg.queries.some((q) => q.includes('bytes BYTEA')))
	assert.ok(fakePg.txCalls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ'))
	assert.ok(fakePg.txCalls.includes('COMMIT'))
	assert.ok(!fakePg.queries.some((q) => q.includes('sqlite_master')))

	const alpha = boards.forTenant({ tenantId: 'ten-alpha' })
	const beta = boards.forTenant({ tenantId: 'ten-beta' })
	const created = await alpha.createCanvas('Postgres board', true)
	assert.equal(created.state.canvases.length, 2)

	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
	const imageId = await alpha.saveImage(png, 'image/png')
	assert.ok(remoteBlobs.has(imageBlobKey('ten-alpha', imageId)))

	const fetched = await alpha.getImage(imageId)
	assert.deepEqual(fetched?.bytes, png)
	assert.equal(fetched?.contentType, 'image/png')
	assert.equal(await beta.getImage(imageId), undefined)
	assert.ok(authHeaders.every((h) => h === 'Bearer azure-token-123'))

	// Metadata row in SQL should not store inline bytes
	const metaRow = await sql.get<{ bytes: Uint8Array | null }>(
		'SELECT bytes FROM image_assets WHERE id = ? AND tenant_id = ?',
		[imageId, 'ten-alpha'],
	)
	assert.equal(metaRow?.bytes, null)

	await boards.close()
	assert.equal(fakePg.closed(), true)
})

test('BoardStore cleans up uploaded blob if SQL metadata insert fails', async () => {
	const blobs = createMemoryBlobStore()
	const fakePg = createFakePgPool()
	const baseSql = createPostgresSql({ pool: fakePg.pool })
	const failingSql = {
		...baseSql,
		async transaction<T>(op: Parameters<typeof baseSql.transaction<T>>[0]): Promise<T> {
			return baseSql.transaction(async (tx) =>
				op({
					...tx,
					async run(query, params) {
						if (query.startsWith('INSERT INTO image_assets')) {
							throw new Error('simulated SQL failure')
						}
						return tx.run(query, params)
					},
				}),
			)
		},
	}

	const boards = new BoardStore({ sql: failingSql, blobs })
	const tenant = boards.forTenant({ tenantId: 'ten-fail' })
	await tenant.getState()

	await assert.rejects(
		() => tenant.saveImage(new Uint8Array([1, 2, 3]), 'image/png'),
		/simulated SQL failure/,
	)
	// No orphan blobs left behind
	const keysAfter = await failingSql.all<{ id: string }>('SELECT id FROM image_assets')
	assert.equal(keysAfter.length, 0)
	await boards.close()
})

test('Cloudflare D1 binding + R2 binding supports full BoardStore lifecycle', async () => {
	const fakeD1 = createFakeD1Database()
	const r2Bucket = createFakeR2Bucket()
	const sql = createD1Sql(fakeD1.db)
	const blobs = createR2BlobStore(r2Bucket)

	assert.equal(sql.dialect, 'd1')
	assert.equal(sql.concurrent, false)

	const boards = new BoardStore({ sql, blobs })
	const demo = boards.forTenant({ tenantId: 'demo' })
	const created = await demo.createCanvas('CF D1 Canvas', true)
	assert.equal(created.state.canvases.length, 2)

	const img = new Uint8Array([0x52, 0x49, 0x46, 0x46])
	const imageId = await demo.saveImage(img, 'image/webp')
	const loaded = await demo.getImage(imageId)
	assert.deepEqual(loaded?.bytes, img)
	assert.equal(loaded?.contentType, 'image/webp')

	await boards.close()
	fakeD1.close()
})

test('Cloudflare D1 HTTP + R2 S3 REST clients format requests and signatures correctly', async () => {
	const d1Calls: Array<{ url: string; sql: string; params: unknown[] }> = []
	const fakeD1 = createFakeD1Database()

	const d1Fetch: typeof fetch = async (input, init) => {
		const body = JSON.parse(String(init?.body ?? '{}')) as { sql: string; params: unknown[] }
		d1Calls.push({ url: String(input), sql: body.sql, params: body.params })
		const headers = (init?.headers ?? {}) as Record<string, string>
		assert.equal(headers.Authorization, 'Bearer cf-token')

		const stmt = fakeD1.db.prepare(body.sql)
		const bound = body.params.length > 0 ? stmt.bind(...body.params) : stmt
		const res = /^(SELECT|WITH)\b/i.test(body.sql.trim()) ? await bound.all() : await bound.run()
		return new Response(
			JSON.stringify({
				success: true,
				result: [{ success: true, results: res.results ?? [], meta: res.meta ?? { changes: 0 } }],
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		)
	}

	const r2Objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
	const r2AuthHeaders: string[] = []
	const r2Fetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input))
		const headers = (init?.headers ?? {}) as Record<string, string>
		r2AuthHeaders.push(headers.Authorization ?? '')
		assert.ok(headers['x-amz-content-sha256'])
		assert.ok(headers['x-amz-date'])
		const key = decodeURIComponent(url.pathname.replace(/^\/mico-r2\//, ''))

		if (init?.method === 'PUT') {
			r2Objects.set(key, {
				bytes: new Uint8Array(init.body as Uint8Array),
				contentType: headers['content-type'] ?? 'application/octet-stream',
			})
			return new Response(null, { status: 200 })
		}
		if (init?.method === 'GET') {
			const entry = r2Objects.get(key)
			if (!entry) return new Response(null, { status: 404 })
			return new Response(Buffer.from(entry.bytes), {
				status: 200,
				headers: { 'content-type': entry.contentType },
			})
		}
		if (init?.method === 'DELETE') {
			r2Objects.delete(key)
			return new Response(null, { status: 204 })
		}
		return new Response(null, { status: 405 })
	}

	const sql = createD1Sql({
		accountId: 'acc-1',
		databaseId: 'db-1',
		apiToken: 'cf-token',
		fetch: d1Fetch,
	})
	const blobs = createR2BlobStore({
		accountId: 'acc-1',
		bucket: 'mico-r2',
		accessKeyId: 'AKID',
		secretAccessKey: 'SECRET',
		fetch: r2Fetch,
	})

	const boards = new BoardStore({ sql, blobs })
	const store = boards.forTenant({ tenantId: 'local' })
	const imageId = await store.saveImage(new Uint8Array([9, 8, 7]), 'image/png')
	const fetched = await store.getImage(imageId)

	assert.deepEqual(fetched?.bytes, new Uint8Array([9, 8, 7]))
	assert.equal(fetched?.contentType, 'image/png')
	assert.ok(d1Calls.every((c) => c.url.endsWith('/accounts/acc-1/d1/database/db-1/query')))
	assert.ok(r2AuthHeaders.every((h) => h.startsWith('AWS4-HMAC-SHA256 Credential=AKID/')))

	// Verify deterministic SigV4 output
	const sigHeaders = signR2S3Request({
		method: 'GET',
		url: new URL('https://acc-1.r2.cloudflarestorage.com/mico-r2/local/test'),
		accessKeyId: 'AKID',
		secretAccessKey: 'SECRET',
		region: 'auto',
		payload: new Uint8Array(0),
		now: new Date('2026-11-18T00:00:00.000Z'),
	})
	assert.match(sigHeaders.Authorization, /Credential=AKID\/20261118\/auto\/s3\/aws4_request/)

	await boards.close()
	fakeD1.close()
})

test('storage factory resolves sqlite/azure/cloudflare and fails fast on missing config', async () => {
	assert.equal(resolveStorageBackend({}), 'sqlite')
	assert.equal(resolveStorageBackend({ MICO_STORAGE_BACKEND: 'azure' }), 'azure')
	assert.equal(resolveStorageBackend({ MICO_STORAGE_BACKEND: 'CLOUDFLARE' }), 'cloudflare')
	assert.throws(() => resolveStorageBackend({ MICO_STORAGE_BACKEND: 'mysql' }), /Unsupported/)

	assert.throws(() => createBoardStoreFromEnv({ MICO_STORAGE_BACKEND: 'azure' }), /MICO_PG_URL/)
	assert.throws(
		() =>
			createBoardStoreFromEnv({
				MICO_STORAGE_BACKEND: 'azure',
				MICO_PG_URL: 'postgres://user:pass@localhost:5432/mico',
			}),
		/MICO_AZURE_STORAGE_ACCOUNT/,
	)
	assert.throws(
		() => createBoardStoreFromEnv({ MICO_STORAGE_BACKEND: 'cloudflare' }),
		/MICO_CF_ACCOUNT_ID/,
	)

	const dir = mkdtempSync(join(tmpdir(), 'mico-storage-factory-'))
	try {
		const boards = createBoardStoreFromEnv({ MICO_DB_PATH: join(dir, 'board.sqlite') })
		assert.equal(boards.sql.dialect, 'sqlite')
		await boards.close()
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})
