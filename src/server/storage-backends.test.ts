import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createMemoryBlobStore, imageBlobKey } from './blob.ts'
import { createAzureBlobStore } from './blob-azure.ts'
import { createSqliteSql, rewritePgPlaceholders, splitSqlStatements } from './sql.ts'
import { createPostgresSql, type PgClientLike, type PgPoolLike } from './sql-postgres.ts'
import { createBoardStoreFromEnv, resolveStorageBackend } from './storage.ts'
import { BoardStore, MAX_CANVAS_IMAGES, OperationError } from './store.ts'

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
	assert.ok(!fakePg.queries.some((q) => q.includes('sqlite_master')))

	const alpha = boards.forTenant({ tenantId: 'ten-alpha' })
	const beta = boards.forTenant({ tenantId: 'ten-beta' })
	const created = await alpha.createCanvas('Postgres board', true)
	assert.equal(created.state.canvases.length, 2)
	assert.equal(typeof (await alpha.getState()).stateVersion, 'number')
	// Writes keep the default isolation; multi-statement reads ask for one
	// stable snapshot.
	assert.ok(fakePg.txCalls.includes('BEGIN'))
	assert.ok(fakePg.txCalls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ'))
	assert.ok(fakePg.txCalls.includes('COMMIT'))

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

test('demo actor scopes retain PostgreSQL grants, ownership metadata, and the blob backend', async () => {
	const fakePg = createFakePgPool()
	const sql = createPostgresSql({ pool: fakePg.pool })
	const blobs = createMemoryBlobStore()
	const boards = new BoardStore({ sql, blobs })
	try {
		const tenant = boards.forTenant({ tenantId: 'mtg-ownership' })
		const presenterId = 'a'.repeat(64)
		const guestId = 'b'.repeat(64)
		const host = tenant.forDemoParticipant(() => ({ participantId: presenterId, presenter: true }))
		const guest = tenant.forDemoParticipant(() => ({ participantId: guestId, presenter: false }))
		const imageId = await host.saveImage(new Uint8Array([1, 2, 3]), 'image/png')
		assert.ok(await blobs.get(imageBlobKey(tenant.tenantId, imageId)))
		assert.deepEqual((await guest.getImage(imageId))?.bytes, new Uint8Array([1, 2, 3]))
		const created = await host.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'owned', type: 'rectangle', x: 0, y: 0, w: 80, h: 60, color: '#123456' },
				},
			],
		})
		assert.deepEqual(created.objectOwners, { owned: presenterId })
		const update = { operations: [{ type: 'update' as const, id: 'owned', patch: { x: 20 } }] }
		await assert.rejects(guest.apply(update), { code: 'OBJECT_EDIT_FORBIDDEN' })
		const canvasId = (await host.getState()).activeCanvasId
		await host.setCanvasEditor(canvasId, guestId, true)
		assert.deepEqual((await guest.getState()).canvasEditorIds, [guestId])
		assert.deepEqual((await guest.apply(update)).objectOwners, { owned: presenterId })
		await host.setCanvasEditor(canvasId, guestId, false)
		await assert.rejects(guest.apply(update), { code: 'OBJECT_EDIT_FORBIDDEN' })
	} finally {
		await boards.close()
	}
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

test('storage factory resolves sqlite/azure and rejects unsupported backends', async () => {
	assert.equal(resolveStorageBackend({}), 'sqlite')
	assert.equal(resolveStorageBackend({ MICO_STORAGE_BACKEND: 'azure' }), 'azure')
	assert.throws(
		() => resolveStorageBackend({ MICO_STORAGE_BACKEND: 'CLOUDFLARE' }),
		/cloudflare is unsupported: D1 provides no interactive transactions/,
	)
	assert.throws(() => resolveStorageBackend({ MICO_STORAGE_BACKEND: 'mysql' }), /Unsupported/)
	assert.throws(
		() => createBoardStoreFromEnv({ MICO_STORAGE_BACKEND: 'cloudflare' }),
		/cloudflare is unsupported/,
	)

	assert.throws(() => createBoardStoreFromEnv({ MICO_STORAGE_BACKEND: 'azure' }), /MICO_PG_URL/)
	assert.throws(
		() =>
			createBoardStoreFromEnv({
				MICO_STORAGE_BACKEND: 'azure',
				MICO_PG_URL: 'postgres://user:pass@localhost:5432/mico',
			}),
		/MICO_AZURE_STORAGE_ACCOUNT/,
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

function createTrackedBlobStore(): {
	blobs: ReturnType<typeof createMemoryBlobStore>
	keys: () => string[]
} {
	const memory = createMemoryBlobStore()
	const live = new Set<string>()
	return {
		blobs: {
			async put(key, bytes, contentType) {
				await memory.put(key, bytes, contentType)
				live.add(key)
			},
			async get(key) {
				return memory.get(key)
			},
			async delete(key) {
				await memory.delete(key)
				live.delete(key)
			},
		},
		keys: () => [...live],
	}
}

test('generated images persist through a blob store like uploads', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-generated-blob-'))
	const tracked = createTrackedBlobStore()
	const boards = new BoardStore({
		sql: createSqliteSql(join(directory, 'board.sqlite')),
		blobs: tracked.blobs,
	})
	const store = boards.forTenant({ tenantId: 'ten-generated' })
	try {
		const state = await store.getState()
		const uploaded = new Uint8Array([1, 2, 3, 4])
		const uploadedId = await store.saveImage(uploaded, 'image/png')

		const framed = await store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'target-frame',
						type: 'frame',
						x: 0,
						y: 200,
						w: 400,
						h: 300,
						color: '#5b5fc7',
						title: 'Generated target',
					},
				},
			],
		})
		assert.equal(framed.revision, 1)

		const generated = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])
		const placed = await store.placeGeneratedImage({
			canvasId: state.activeCanvasId,
			shapeId: 'generated-image',
			frameId: 'target-frame',
			x: 40,
			y: 240,
			w: 120,
			h: 80,
			bytes: generated,
		})
		assert.equal(placed.backgroundApplied, true)

		const fetched = await store.getImage(placed.imageId)
		assert.deepEqual(fetched?.bytes, generated)
		assert.equal(fetched?.contentType, 'image/png')
		assert.deepEqual((await store.getImage(uploadedId))?.bytes, uploaded)

		for (const assetId of [placed.imageId, uploadedId]) {
			const row = await boards.sql.get<{ bytes: Uint8Array | null }>(
				'SELECT bytes FROM image_assets WHERE id = ? AND tenant_id = ?',
				[assetId, 'ten-generated'],
			)
			assert.equal(row?.bytes, null)
		}

		const assets = await boards.sql.all<{ id: string }>(
			'SELECT id FROM image_assets WHERE tenant_id = ?',
			['ten-generated'],
		)
		assert.deepEqual(
			new Set(tracked.keys()),
			new Set(assets.map((asset) => `ten-generated/${asset.id}`)),
		)
	} finally {
		await boards.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('generated image placements keep guards and compensation with a blob store', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-generated-guards-'))
	const tracked = createTrackedBlobStore()
	const boards = new BoardStore({
		sql: createSqliteSql(join(directory, 'board.sqlite')),
		blobs: tracked.blobs,
	})
	const store = boards.forTenant({ tenantId: 'ten-guards' })
	const generated = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
	try {
		const state = await store.getState()
		await store.placeGeneratedImage({
			canvasId: state.activeCanvasId,
			shapeId: 'generated-image',
			x: 0,
			y: 0,
			w: 120,
			h: 80,
			bytes: generated,
		})

		await assert.rejects(
			store.placeGeneratedImage({
				canvasId: state.activeCanvasId,
				shapeId: 'generated-image',
				x: 300,
				y: 0,
				w: 120,
				h: 80,
				bytes: generated,
			}),
			(error: unknown) => error instanceof OperationError && error.code === 'DUPLICATE_ID',
		)

		for (let index = 1; index < MAX_CANVAS_IMAGES; index += 1) {
			await store.placeGeneratedImage({
				canvasId: state.activeCanvasId,
				shapeId: `generated-image-${index}`,
				x: 300 * index,
				y: 0,
				w: 120,
				h: 80,
				bytes: generated,
			})
		}
		await assert.rejects(
			store.placeGeneratedImage({
				canvasId: state.activeCanvasId,
				shapeId: 'over-cap-image',
				x: 0,
				y: 500,
				w: 120,
				h: 80,
				bytes: generated,
			}),
			(error: unknown) => error instanceof OperationError && error.code === 'IMAGE_CAP_REACHED',
		)

		await boards.sql.exec(`
			CREATE TRIGGER reject_revision BEFORE UPDATE OF revision ON canvases
			BEGIN SELECT RAISE(IGNORE); END;
		`)
		const conflictCanvas = await store.createCanvas('Conflict canvas', true)
		await assert.rejects(
			store.placeGeneratedImage({
				canvasId: conflictCanvas.canvas.id,
				shapeId: 'conflicted-image',
				x: 0,
				y: 900,
				w: 120,
				h: 80,
				bytes: generated,
			}),
			(error: unknown) => error instanceof OperationError && error.code === 'REVISION_CONFLICT',
		)

		const assets = await boards.sql.all<{ id: string }>(
			'SELECT id FROM image_assets WHERE tenant_id = ?',
			['ten-guards'],
		)
		assert.equal(assets.length, MAX_CANVAS_IMAGES)
		assert.deepEqual(
			new Set(tracked.keys()),
			new Set(assets.map((asset) => `ten-guards/${asset.id}`)),
		)
	} finally {
		await boards.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('a write transaction is never replayed on a serialization failure', async () => {
	const fakePg = createFakePgPool()
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
	const puts: string[] = []
	const blobs = {
		async put(key: string) {
			puts.push(key)
		},
		async get() {
			return undefined
		},
		async delete() {},
	}
	let failNextCommit = false
	const pool: PgPoolLike = {
		query: (text, values) => fakePg.pool.query(text, values),
		async connect() {
			const client = await fakePg.pool.connect()
			return {
				async query(text: string, values?: readonly unknown[]) {
					if (text.trim() === 'COMMIT' && failNextCommit) {
						failNextCommit = false
						throw Object.assign(new Error('could not serialize access due to concurrent update'), {
							code: '40001',
						})
					}
					return client.query(text, values)
				},
				release(err) {
					client.release(err)
				},
			}
		},
		end: () => fakePg.pool.end(),
	}
	const boards = new BoardStore({ sql: createPostgresSql({ pool }), blobs })
	const store = boards.forTenant({ tenantId: 'ten-commit-race' })
	try {
		const state = await store.getState()
		const before = await store.getBoard()
		failNextCommit = true
		await assert.rejects(
			store.placeGeneratedImage({
				canvasId: state.activeCanvasId,
				shapeId: 'replayed-image',
				x: 0,
				y: 0,
				w: 120,
				h: 80,
				bytes: png,
			}),
			/serialization|40001|serialize/i,
		)
		assert.equal(puts.length, 1)
		assert.deepEqual(await store.getBoard(), before)
		assert.deepEqual(await boards.sql.all('SELECT id FROM image_assets'), [])
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(puts.length, 1)
	} finally {
		await boards.close()
	}
})
