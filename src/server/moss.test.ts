import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import WebSocket from 'ws'
import { DEV_ORIGIN } from '../shared/config.ts'
import type { Board, Operation, Shape } from '../shared/types.ts'
import { createDaemon, type Daemon } from './index.ts'
import {
	createMossSession,
	executeMossTool,
	type MossStore,
	mossSessionSchema,
	mossToolSchema,
} from './mossApi.ts'
import {
	forwardMossFrame,
	isMossUpgradeAllowed,
	MOSS_MAX_PAYLOAD,
	MOSS_UPSTREAM_URL,
	pipeMossSockets,
} from './mossProxy.ts'
import { OperationError } from './store.ts'

class MockMossStore implements MossStore {
	activeCanvasId = 'canvas-a'
	boards = new Map<string, Board>([['canvas-a', { revision: 3, shapes: [] }]])

	getActiveCanvasId(): string {
		return this.activeCanvasId
	}

	getBoard(canvasId = this.activeCanvasId): Board {
		const board = this.boards.get(canvasId)
		if (!board) throw new OperationError(404, 'NOT_FOUND', `Canvas not found: ${canvasId}`)
		return {
			revision: board.revision,
			shapes: board.shapes.map((shape) => ({ ...shape })) as Shape[],
		}
	}

	applyRequest(request: unknown): unknown {
		const record = request as Record<string, unknown>
		const canvasId = typeof record.canvasId === 'string' ? record.canvasId : this.activeCanvasId
		const board = this.getBoard(canvasId)
		if (record.expectedRevision !== undefined && record.expectedRevision !== board.revision) {
			throw new OperationError(409, 'REVISION_CONFLICT', 'Canvas revision changed')
		}
		const operations = record.operations as Operation[]
		const next = board.shapes.map((shape) => ({ ...shape })) as Shape[]
		for (const operation of operations) {
			if (operation.type === 'create') {
				const existing = next.findIndex((shape) => shape.id === operation.shape.id)
				if (existing >= 0) next[existing] = { ...operation.shape }
				else next.push(operation.shape)
			} else if (operation.type === 'update') {
				const index = next.findIndex((shape) => shape.id === operation.id)
				if (index >= 0) next[index] = { ...next[index], ...operation.patch } as Shape
			} else {
				const index = next.findIndex((shape) => shape.id === operation.id)
				if (index >= 0) next.splice(index, 1)
			}
		}
		const updated = { revision: board.revision + (operations.length > 0 ? 1 : 0), shapes: next }
		this.boards.set(canvasId, updated)
		return { canvasId, canvas: { id: canvasId }, board: updated }
	}
}

async function withDaemon(run: (url: string, daemon: Daemon) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-moss-api-'))
	let daemon: Daemon | undefined
	try {
		daemon = createDaemon({
			port: 0,
			dbPath: join(directory, 'board.sqlite'),
			settingsPath: join(directory, 'ai-settings', 'settings.json'),
		})
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		await run(`http://127.0.0.1:${address.port}`, daemon)
	} finally {
		if (daemon) {
			for (const client of daemon.wss.clients) client.terminate()
			daemon.close()
		}
		rmSync(directory, { recursive: true, force: true })
	}
}

function rawPost(
	url: string,
	path: string,
	body: unknown,
	host?: string,
	origin?: string,
): Promise<{
	status: number
	body: unknown
}> {
	const parsed = new URL(url)
	const payload = JSON.stringify(body)
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: parsed.hostname,
				port: parsed.port,
				path,
				method: 'POST',
				headers: {
					Host: host ?? parsed.host,
					Origin: origin ?? DEV_ORIGIN,
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(payload),
				},
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
				res.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8')
					resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null })
				})
			},
		)
		req.on('error', reject)
		req.end(payload)
	})
}

test('MOSS session serializes real native canvas tools and pinned instructions', async () => {
	const store = new MockMossStore()
	store.boards.set('canvas-b', { revision: 7, shapes: [] })
	const session = await createMossSession(store, () => {}, {
		canvasId: 'canvas-b',
		selection: ['selected-a'],
	})
	assert.equal(session.canvasId, 'canvas-b')
	assert.equal(session.revision, 7)
	assert.ok(session.tools.length > 8)
	assert.ok(session.tools.every((tool) => tool.type === 'function'))
	assert.ok(
		session.tools.every(
			(tool) => typeof tool.name === 'string' && typeof tool.parameters === 'object',
		),
	)
	assert.match(session.instructions, /Mico, a live whiteboard copilot/)
	assert.match(session.instructions, /full-duplex voice session/)
	assert.match(session.instructions, /User speech and interruptions/)
	assert.doesNotMatch(session.instructions, /reply with exactly WAIT/)
	const getBoard = session.tools.find((tool) => tool.name === 'get_board')
	assert.ok(getBoard)
	assert.equal((getBoard.parameters as Record<string, unknown>).type, 'object')
})

test('MOSS session and tool envelopes reject unknown and extra fields', () => {
	assert.equal(mossSessionSchema.safeParse({ canvasId: 'a', extra: true }).success, false)
	assert.equal(mossSessionSchema.safeParse({ selection: ['a'] }).success, true)
	assert.equal(
		mossToolSchema.safeParse({
			canvasId: 'a',
			selection: [],
			revision: 0,
			name: 'get_board',
			input: {},
			extra: true,
		}).success,
		false,
	)
})

test('MOSS tool args are validated and results come only after real execution', async () => {
	const store = new MockMossStore()
	store.boards.set('canvas-b', { revision: 0, shapes: [] })
	store.activeCanvasId = 'canvas-a'
	const result = await executeMossTool(store, () => {}, {
		canvasId: 'canvas-b',
		selection: [],
		revision: 0,
		name: 'add_texts',
		input: { texts: [{ id: 'pinned', x: 10, y: 20, text: 'Pinned result' }] },
	})
	const reply = result.result as { ok: boolean; revision: number; created: { id: string }[] }
	assert.equal(reply.ok, true)
	assert.equal(reply.revision, 1)
	assert.deepEqual(reply.created, [{ id: 'pinned', type: 'text' }])
	assert.equal(store.getBoard('canvas-a').shapes.length, 0)
	assert.equal(store.getBoard('canvas-b').shapes.length, 1)

	await assert.rejects(
		executeMossTool(store, () => {}, {
			canvasId: 'canvas-b',
			selection: [],
			revision: 1,
			name: 'add_texts',
			input: { texts: [{ x: 10, y: 20, text: '' }] },
		}),
		(error: unknown) => error instanceof OperationError && error.code === 'INVALID_TOOL_INPUT',
	)
	await assert.rejects(
		executeMossTool(store, () => {}, {
			canvasId: 'canvas-b',
			selection: [],
			revision: 1,
			name: 'missing_tool',
			input: {},
		}),
		(error: unknown) => error instanceof OperationError && error.code === 'UNKNOWN_TOOL',
	)
})

test('another editor can be recovered with stale get_board then a correct retry', async () => {
	const store = new MockMossStore()
	store.boards.set('canvas-a', { revision: 0, shapes: [] })

	store.applyRequest({
		canvasId: 'canvas-a',
		operations: [
			{
				type: 'create',
				shape: { id: 'human-edit', type: 'note', x: 300, y: 10, w: 200, h: 100, color: '#fff8d4' },
			},
		],
		expectedRevision: 0,
	})

	const recovered = await executeMossTool(store, () => {}, {
		canvasId: 'canvas-a',
		selection: [],
		revision: 0,
		name: 'get_board',
		input: {},
	})
	const digest = recovered.result as { revision: number; shapes: { id: string }[] }
	assert.equal(digest.revision, 1)
	assert.ok(digest.shapes.some((shape) => shape.id === 'human-edit'))

	const retried = await executeMossTool(store, () => {}, {
		canvasId: 'canvas-a',
		selection: [],
		revision: digest.revision,
		name: 'add_texts',
		input: { texts: [{ id: 'moss-retry', x: 10, y: 10, text: 'Correct retry' }] },
	})
	assert.equal((retried.result as { ok: boolean; revision: number }).ok, true)
	assert.equal((retried.result as { revision: number }).revision, 2)
	assert.ok(store.getBoard('canvas-a').shapes.some((shape) => shape.id === 'moss-retry'))
})

test('MOSS mutations reject stale revisions with get_board guidance', async () => {
	const store = new MockMossStore()
	store.boards.set('canvas-a', { revision: 4, shapes: [] })
	await assert.rejects(
		executeMossTool(store, () => {}, {
			canvasId: 'canvas-a',
			selection: [],
			revision: 3,
			name: 'update_shapes',
			input: { updates: [{ id: 'missing', patch: { x: 1 } }] },
		}),
		(error: unknown) => {
			assert.ok(error instanceof OperationError)
			assert.equal(error.code, 'REVISION_CONFLICT')
			assert.match(error.message, /Call get_board first/)
			return true
		},
	)
})

test('MOSS HTTP routes validate host and origin and expose the fixed contract', async () => {
	await withDaemon(async (url) => {
		const badOrigin = await rawPost(url, '/api/moss/session', {}, undefined, 'https://evil.example')
		assert.equal(badOrigin.status, 403)
		assert.equal((badOrigin.body as { error: string }).error, 'FORBIDDEN_ORIGIN')

		const badHost = await rawPost(url, '/api/moss/session', {}, 'evil.example', DEV_ORIGIN)
		assert.equal(badHost.status, 403)
		assert.equal((badHost.body as { error: string }).error, 'FORBIDDEN_HOST')

		const session = await rawPost(
			url,
			'/api/moss/session',
			{ selection: [] },
			undefined,
			DEV_ORIGIN,
		)
		assert.equal(session.status, 200)
		const response = session.body as {
			canvasId: string
			revision: number
			instructions: string
			tools: { type: string; name: string; parameters: unknown }[]
		}
		assert.equal(typeof response.canvasId, 'string')
		assert.equal(typeof response.revision, 'number')
		assert.match(response.instructions, /MOSS Live realtime voice and tools/)
		assert.ok(response.tools.some((tool) => tool.type === 'function' && tool.name === 'add_texts'))

		const staleRead = await rawPost(
			url,
			'/api/moss/tool',
			{
				canvasId: response.canvasId,
				selection: [],
				revision: response.revision + 1,
				name: 'get_board',
				input: {},
			},
			undefined,
			DEV_ORIGIN,
		)
		assert.equal(staleRead.status, 200)
		assert.equal(
			(staleRead.body as { result: { revision: number } }).result.revision,
			response.revision,
		)

		const staleMutation = await rawPost(
			url,
			'/api/moss/tool',
			{
				canvasId: response.canvasId,
				selection: [],
				revision: response.revision + 1,
				name: 'add_texts',
				input: { texts: [{ x: 10, y: 10, text: 'Stale' }] },
			},
			undefined,
			DEV_ORIGIN,
		)
		assert.equal(staleMutation.status, 409)
		assert.equal((staleMutation.body as { error: string }).error, 'REVISION_CONFLICT')
		assert.match((staleMutation.body as { message: string }).message, /Call get_board first/)
	})
})

test('MOSS proxy origin checks use same-origin loopback or mico.dev.hexly.ai', () => {
	assert.equal(isMossUpgradeAllowed('http://127.0.0.1:7063', '127.0.0.1:7063'), true)
	assert.equal(isMossUpgradeAllowed('http://localhost:7063', 'localhost:7063'), true)
	assert.equal(isMossUpgradeAllowed(DEV_ORIGIN, 'mico.dev.hexly.ai'), true)
	assert.equal(isMossUpgradeAllowed('http://127.0.0.1:7063', 'localhost:7063'), false)
	assert.equal(isMossUpgradeAllowed('https://evil.example', 'evil.example'), false)
	assert.equal(isMossUpgradeAllowed(undefined, '127.0.0.1:7063'), false)
	assert.equal(MOSS_MAX_PAYLOAD, 1024 * 1024)
	assert.doesNotMatch(MOSS_UPSTREAM_URL, /Bearer|MOSS_API_KEY|api[_-]?key/i)
})

test('MOSS proxy forwards binary and text frames and applies buffered backpressure', () => {
	class FakeSocket {
		readyState = WebSocket.OPEN
		bufferedAmount = 0
		sent: { data: WebSocket.RawData; options: unknown }[] = []
		send(data: WebSocket.RawData, options: unknown): void {
			this.sent.push({ data, options })
		}
	}
	const target = new FakeSocket()
	assert.equal(
		forwardMossFrame(target as unknown as WebSocket, Buffer.from([1, 2]), true, 1024),
		true,
	)
	assert.deepEqual(target.sent[0].data as Buffer, Buffer.from([1, 2]))
	assert.deepEqual(target.sent[0].options, { binary: true })
	target.bufferedAmount = 2048
	assert.equal(
		forwardMossFrame(target as unknown as WebSocket, Buffer.from('text'), false, 1024),
		false,
	)

	const clientSent: unknown[] = []
	const clientClosed: { code: number; reason: string }[] = []
	const client = new EventEmitter() as EventEmitter & {
		readyState: number
		sent: unknown[]
		closed: { code: number; reason: string }[]
		close(code: number, reason: string): void
		terminate(): void
		send(data: unknown): void
	}
	Object.assign(client, {
		readyState: WebSocket.OPEN,
		sent: clientSent,
		closed: clientClosed,
		close(code: number, reason: string) {
			clientClosed.push({ code, reason })
		},
		terminate() {},
		send(data: unknown) {
			clientSent.push(data)
		},
	})
	const upstreamSent: unknown[] = []
	const upstreamClosed: string[] = []
	const upstream = new EventEmitter() as EventEmitter & {
		readyState: number
		sent: unknown[]
		closed: string[]
		close(): void
		terminate(): void
		send(data: unknown, options: unknown): void
	}
	Object.assign(upstream, {
		readyState: WebSocket.OPEN,
		sent: upstreamSent,
		closed: upstreamClosed,
		close() {
			upstreamClosed.push('close')
		},
		terminate() {
			upstreamClosed.push('terminate')
		},
		send(data: unknown, options: unknown) {
			upstreamSent.push({ data, options })
		},
	})
	pipeMossSockets(client as unknown as WebSocket, upstream as unknown as WebSocket, 1024)
	client.emit('message', Buffer.from([3, 4]), true)
	assert.deepEqual((upstream.sent[0] as { data: Buffer }).data, Buffer.from([3, 4]))
	upstream.emit('message', 'hello', false)
	assert.equal(client.sent[0], 'hello')
	upstream.emit('error')
	assert.equal(JSON.parse(client.sent[1] as string).action, 'proxy.error')
	assert.doesNotMatch(JSON.stringify(client.sent), /MOSS_API_KEY|Bearer|api[_-]?key/i)
})
