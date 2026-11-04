import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CANDY_TINTS } from '../shared/palette.ts'
import {
	MAGPIE_DEFAULT_BASE_URL,
	MAGPIE_DEFAULT_MODEL,
	magpieSettings,
	sanitizeInterruptedMessages,
} from './ai.ts'
import { digestShape } from './aiBoard.ts'
import { createMockAiModel } from './aiMock.ts'
import { buildInstructions } from './aiPrompt.ts'
import { createCanvasTools } from './aiTools.ts'
import { createDaemon, type Daemon } from './index.ts'
import { BoardStore } from './store.ts'

type Execute = (input: unknown, options: unknown) => Promise<unknown>
const run = (tool: unknown, input: unknown) =>
	(tool as { execute: Execute }).execute(input, { toolCallId: 'test-call', messages: [] })

function withStore(runTest: (store: BoardStore, broadcast: unknown[]) => Promise<void> | void) {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	return Promise.resolve(runTest(store, [])).finally(() => {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	})
}

test('Magpie settings default to Luna and allow an optional key', () => {
	assert.deepEqual(magpieSettings({}), {
		baseURL: MAGPIE_DEFAULT_BASE_URL,
		model: MAGPIE_DEFAULT_MODEL,
		apiKey: 'magpie',
	})
	assert.equal(magpieSettings({ MAGPIE_API_KEY: '' }).apiKey, '')
	assert.equal(
		magpieSettings({
			MAGPIE_BASE_URL: 'http://127.0.0.1:9999/v1/',
			MAGPIE_MODEL: 'group/coding',
		}).baseURL,
		'http://127.0.0.1:9999/v1',
	)
})

test('AI tools create a labelled lesson and connect existing ids', async () => {
	await withStore(async (store) => {
		const events: unknown[] = []
		const tools = createCanvasTools({
			store,
			broadcast: (event) => events.push(event),
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})

		const text = (await run(tools.add_texts, {
			texts: [{ id: 'title', x: 80, y: 60, text: 'Projectile motion', fontSize: 48 }],
		})) as { ok: boolean; revision: number; created: { id: string }[] }
		assert.equal(text.ok, true)
		assert.equal(text.revision, 1)
		assert.deepEqual(
			text.created.map((shape) => shape.id),
			['title'],
		)
		assert.ok(events.length > 0)

		const boxes = (await run(tools.add_boxes, {
			boxes: [
				{ id: 'launch', x: 120, y: 260, w: 180, h: 80, text: 'Launch' },
				{ id: 'ball', kind: 'ellipse', x: 560, y: 160, w: 120, h: 120, text: 'Ball' },
			],
		})) as { ok: boolean; created: { id: string }[] }
		assert.equal(boxes.ok, true)
		assert.equal(boxes.created.length, 2)

		const connector = (await run(tools.add_connectors, {
			connectors: [{ id: 'flow', from: 'launch', to: 'ball' }],
		})) as { ok: boolean; created: { id: string; type: string }[] }
		assert.equal(connector.ok, true)
		assert.deepEqual(connector.created, [{ id: 'flow', type: 'connector' }])
		assert.equal(store.getBoard().shapes.length, 4)
	})
})

test('AI tools report validation errors without writing', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		const reply = (await run(tools.add_connectors, {
			connectors: [{ id: 'missing', from: 'ghost-a', to: 'ghost-b' }],
		})) as { ok: boolean; error?: string; message?: string }
		assert.equal(reply.ok, false)
		assert.equal(reply.error, 'INVALID_REQUEST')
		assert.match(reply.message ?? '', /invalid endpoint/)
		assert.equal(store.getBoard().shapes.length, 0)

		const missing = (await run(tools.update_shapes, {
			updates: [{ id: 'ghost', patch: { x: 10 } }],
		})) as { ok: boolean; error?: string }
		assert.equal(missing.ok, false)
		assert.equal(missing.error, 'NOT_FOUND')
	})
})

test('AI tools estimate text bounds and derive stroke bounds from absolute points', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_texts, {
			texts: [
				{
					id: 'cjk',
					x: 0,
					y: 0,
					text: '自由落体\n运动',
					fontSize: 32,
				},
			],
		})
		await run(tools.add_strokes, {
			strokes: [
				{
					id: 'arc',
					points: [
						{ x: 10, y: 20 },
						{ x: 110, y: 5 },
						{ x: 210, y: 60 },
					],
				},
			],
		})
		const shapes = store.getBoard().shapes
		const text = shapes.find((shape) => shape.id === 'cjk')
		assert.ok(text && text.type === 'text')
		assert.ok(text.w >= 64)
		assert.ok(text.h >= 80)
		const stroke = shapes.find((shape) => shape.id === 'arc')
		assert.ok(stroke && stroke.type === 'path')
		assert.equal(stroke.x, 10)
		assert.equal(stroke.y, 5)
		assert.equal(stroke.w, 200)
		assert.equal(stroke.h, 55)
		assert.deepEqual(stroke.points?.[0], { x: 0, y: 15 })
	})
})

test('board context marks the user selection as primary context', () => {
	const board = {
		revision: 3,
		shapes: [
			{ id: 'seed', type: 'rectangle' as const, x: 40, y: 80, w: 200, h: 100, color: '#00a2e1' },
			{ id: 'other', type: 'note' as const, x: 300, y: 80, w: 200, h: 120, color: '#fff8d4' },
		],
	}
	const prompt = buildInstructions(board, ['seed'])
	assert.match(prompt, /User selection \(1\): seed/)
	assert.match(prompt, /primary context/)
	assert.match(prompt, /"id":"seed"/)
	assert.match(prompt, /bounds x=40 y=80 w=460 h=120/)
})

async function withDaemon(
	runTest: (context: {
		daemon: Daemon
		url: string
		model: ReturnType<typeof createMockAiModel>
	}) => Promise<void>,
) {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-http-'))
	const model = createMockAiModel()
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		aiModel: model,
	})
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
	const address = daemon.server.address()
	assert.ok(address && typeof address !== 'string')
	try {
		await runTest({ daemon, url: `http://127.0.0.1:${address.port}`, model })
	} finally {
		for (const client of daemon.wss.clients) client.terminate()
		daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

test('AI chat streams a tool loop and draws on the active board', async () => {
	await withDaemon(async ({ daemon, url, model }) => {
		daemon.store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'selected-seed',
						type: 'rectangle',
						x: 40,
						y: 80,
						w: 200,
						h: 100,
						color: '#00a2e1',
						text: 'Selected',
					},
				},
			],
		})
		const response = await fetch(`${url}/api/ai/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				messages: [
					{
						id: 'user-1',
						role: 'user',
						parts: [{ type: 'text', text: 'Draw projectile motion' }],
					},
				],
				selection: ['selected-seed'],
			}),
		})
		assert.equal(response.status, 200)
		assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
		const streamed = await response.text()
		assert.match(streamed, /add_texts/)
		assert.match(streamed, /Projectile motion/)
		const firstPrompt = JSON.stringify(model.doStreamCalls[0]?.prompt)
		assert.match(firstPrompt, /selected-seed/)
		assert.match(firstPrompt, /primary context/)
		const shapes = daemon.store.getBoard().shapes
		assert.equal(shapes.length, 9)
		assert.ok(shapes.some((shape) => shape.id === 'mock-1-title'))
		assert.ok(shapes.some((shape) => shape.id === 'mock-1-flow' && shape.type === 'connector'))
	})
})

test('AI chat rejects invalid requests', async () => {
	await withDaemon(async ({ url }) => {
		const response = await fetch(`${url}/api/ai/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messages: [], selection: [] }),
		})
		assert.equal(response.status, 400)
		const body = (await response.json()) as { error: string }
		assert.equal(body.error, 'INVALID_REQUEST')
	})
})

test('AI tools stay pinned to the canvas captured at request time', async () => {
	await withStore(async (store) => {
		const first = store.getActiveCanvasId()
		const second = store.createCanvas('Second canvas', true).canvas.id
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: first,
		})
		await run(tools.add_texts, {
			texts: [{ id: 'pinned', x: 10, y: 10, text: 'Pinned to the first canvas' }],
		})
		assert.equal(store.getBoard(first).shapes.length, 1)
		assert.equal(store.getBoard(second).shapes.length, 0)
	})
})

test('updates are rejected after a concurrent board change and recover after a re-read', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_texts, {
			texts: [{ id: 'label', x: 10, y: 10, text: 'Before' }],
		})
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'human', type: 'note', x: 300, y: 10, w: 200, h: 100, color: '#fff8d4' },
				},
			],
		})
		const conflict = (await run(tools.update_shapes, {
			updates: [{ id: 'label', patch: { text: 'Stale' } }],
		})) as { ok: boolean; error?: string }
		assert.equal(conflict.ok, false)
		assert.equal(conflict.error, 'REVISION_CONFLICT')
		const label = store.getBoard().shapes.find((shape) => shape.id === 'label')
		assert.equal(label?.type === 'text' ? label.text : null, 'Before')

		await run(tools.add_notes, {
			notes: [{ id: 'unread', x: 600, y: 10, text: 'Unrelated addition' }],
		})
		const stillStale = (await run(tools.update_shapes, {
			updates: [{ id: 'label', patch: { text: 'Still stale' } }],
		})) as { ok: boolean; error?: string }
		assert.equal(stillStale.ok, false)
		assert.equal(stillStale.error, 'REVISION_CONFLICT')

		await run(tools.get_board, {})
		const retried = (await run(tools.update_shapes, {
			updates: [{ id: 'label', patch: { text: 'After' } }],
		})) as { ok: boolean }
		assert.equal(retried.ok, true)
		const updated = store.getBoard().shapes.find((shape) => shape.id === 'label')
		assert.equal(updated?.type === 'text' ? updated.text : null, 'After')
	})
})

test('strokes round points and their bounds together', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		const reply = (await run(tools.add_strokes, {
			strokes: [
				{
					id: 'decimal',
					points: [
						{ x: 0, y: 0 },
						{ x: 1.06, y: 2.06 },
					],
				},
			],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const stroke = store.getBoard().shapes.find((shape) => shape.id === 'decimal')
		assert.ok(stroke && stroke.type === 'path')
		assert.equal(stroke.w, 1.1)
		assert.equal(stroke.h, 2.1)
		assert.deepEqual(stroke.points, [
			{ x: 0, y: 0 },
			{ x: 1.1, y: 2.1 },
		])
	})
})

test('line and path digests keep direction and sampled geometry', () => {
	const line = digestShape({
		id: 'line',
		type: 'line',
		x: 100,
		y: 200,
		w: -40,
		h: 30,
		color: '#2b3038',
	})
	assert.deepEqual(line.start, { x: 100, y: 200 })
	assert.deepEqual(line.end, { x: 60, y: 230 })

	const path = digestShape({
		id: 'path',
		type: 'path',
		x: 50,
		y: 60,
		w: 100,
		h: 40,
		color: '#2b3038',
		points: [
			{ x: 0, y: 0 },
			{ x: 50, y: 20 },
			{ x: 100, y: 40 },
		],
		brush: 'brush',
		strokeWidth: 4,
	})
	assert.equal(path.points, 3)
	assert.deepEqual(path.samples, [
		{ x: 50, y: 60 },
		{ x: 100, y: 80 },
		{ x: 150, y: 100 },
	])

	const longPath = digestShape({
		id: 'long',
		type: 'path',
		x: 0,
		y: 0,
		w: 199,
		h: 199,
		color: '#2b3038',
		points: Array.from({ length: 200 }, (_, index) => ({ x: index, y: index })),
		brush: 'brush',
		strokeWidth: 4,
	})
	assert.equal(longPath.samples?.length, 8)
	assert.deepEqual(longPath.samples?.[0], { x: 0, y: 0 })
	assert.deepEqual(longPath.samples?.at(-1), { x: 199, y: 199 })
})

test('note tints are accepted when updating a note', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_notes, {
			notes: [{ id: 'note', x: 10, y: 10, text: 'Remember' }],
		})
		const reply = (await run(tools.update_shapes, {
			updates: [{ id: 'note', patch: { color: CANDY_TINTS.yellow } }],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const note = store.getBoard().shapes.find((shape) => shape.id === 'note')
		assert.equal(note?.color, CANDY_TINTS.yellow)
	})
})

test('interrupted tool calls are dropped before the next turn', () => {
	const messages = [
		{ id: 'u', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Draw a box' }] },
		{
			id: 'a',
			role: 'assistant' as const,
			parts: [
				{ type: 'text' as const, text: 'Drawing it now.' },
				{
					type: 'tool-add_boxes' as const,
					toolCallId: 'call-1',
					state: 'input-available' as const,
					input: { boxes: [] },
				},
			],
		},
		{
			id: 'b',
			role: 'assistant' as const,
			parts: [
				{
					type: 'tool-add_texts' as const,
					toolCallId: 'call-2',
					state: 'input-streaming' as const,
					input: {},
				},
			],
		},
	]
	const cleaned = sanitizeInterruptedMessages(messages as never)
	assert.equal(cleaned.length, 2)
	assert.deepEqual(cleaned[1].parts, [{ type: 'text', text: 'Drawing it now.' }])
})
