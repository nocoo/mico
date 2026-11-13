import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { CANDY_COLORS, CANDY_TINTS } from '../shared/palette.ts'
import { POST_SESSION_SUMMARY_PROMPT } from '../shared/summaryPrompt.ts'
import { sanitizeInterruptedMessages } from './ai.ts'
import { boardDigest, digestShape } from './aiBoard.ts'
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

test('AI tools create, inspect and update frame titles and note labels', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_notes, {
			notes: [
				{ id: 'left', x: 100, y: 140, text: 'Open question', label: 'Risk' },
				{ id: 'right', x: 420, y: 140, text: 'Next step' },
			],
		})
		await run(tools.add_frames, {
			frames: [{ id: 'area', title: 'Discussion', memberIds: ['left', 'right'] }],
		})
		const initial = (await run(tools.get_board, { ids: ['area', 'left'] })) as {
			shapes: { id: string; label?: string; title?: string }[]
		}
		assert.equal(initial.shapes.find((shape) => shape.id === 'area')?.title, 'Discussion')
		assert.equal(initial.shapes.find((shape) => shape.id === 'left')?.label, 'Risk')

		await run(tools.update_shapes, {
			updates: [
				{ id: 'area', patch: { title: 'Resolved discussion' } },
				{ id: 'left', patch: { label: 'Resolved' } },
			],
		})
		const updated = (await run(tools.get_board, { ids: ['area', 'left'] })) as {
			shapes: { id: string; label?: string; title?: string }[]
		}
		assert.equal(updated.shapes.find((shape) => shape.id === 'area')?.title, 'Resolved discussion')
		assert.equal(updated.shapes.find((shape) => shape.id === 'left')?.label, 'Resolved')
	})
})

test('upsert_action_card preserves completion, omissions and explicit deletes safely', async () => {
	await withStore(async (store) => {
		const canvasId = store.getActiveCanvasId()
		const otherCanvas = store.createCanvas('Other canvas').canvas.id
		const tools = createCanvasTools({ store, broadcast: () => {}, selection: [], canvasId })
		const input = {
			id: 'next-actions',
			x: 80,
			y: 160,
			title: 'Next actions',
			items: [
				{ id: 'owner-a', text: 'Confirm owner' },
				{ id: 'keep-me', text: 'Keep this item' },
				{ id: 'remove-me', text: 'Remove explicitly' },
			],
		}
		const created = (await run(tools.upsert_action_card, input)) as {
			ok: boolean
			revision: number
			created: { id: string }[]
		}
		assert.equal(created.ok, true)
		assert.equal(created.revision, 1)
		assert.deepEqual(store.getBoard(otherCanvas).shapes, [])
		const card = store.getBoard(canvasId).shapes[0]
		assert.ok(card?.type === 'actions')
		assert.equal(card.w, 300)
		assert.equal(card.color, CANDY_TINTS.green)
		assert.ok(card.items)
		assert.ok(card.items.every((item) => item.done === false))
		const initialHeight = card.h

		store.applyRequest({
			canvasId,
			expectedRevision: 1,
			operations: [{ type: 'set_action_done', id: 'next-actions', itemId: 'owner-a', done: true }],
		})
		const stale = (await run(tools.upsert_action_card, {
			...input,
			items: [{ id: 'owner-a', text: 'This stale update must not overwrite completion' }],
		})) as { ok: boolean; error?: string }
		assert.equal(stale.ok, false)
		assert.equal(stale.error, 'REVISION_CONFLICT')
		const completedCard = store.getBoard(canvasId).shapes[0]
		assert.ok(completedCard?.type === 'actions')
		assert.equal(completedCard.items?.find((item) => item.id === 'owner-a')?.done, true)

		const read = (await run(tools.get_board, { ids: ['next-actions'] })) as {
			revision: number
			shapes: { items: { id: string; text: string; done: boolean }[] }[]
		}
		assert.equal(read.revision, 2)
		assert.equal(read.shapes[0].items.length, 3)
		const longText = 'Detailed follow-up '.repeat(40)
		const updated = (await run(tools.upsert_action_card, {
			id: 'next-actions',
			title: 'Updated actions',
			items: [
				{ id: 'owner-a', text: longText },
				{ id: 'new-item', text: 'New explicit item' },
			],
			removeItemIds: ['remove-me'],
		})) as { ok: boolean; revision: number; updated: string[] }
		assert.equal(updated.ok, true)
		assert.equal(updated.revision, 3)
		const updatedCard = store.getBoard(canvasId).shapes[0]
		assert.ok(updatedCard?.type === 'actions')
		assert.deepEqual(
			updatedCard.items?.map((item) => [item.id, item.done]),
			[
				['owner-a', true],
				['keep-me', false],
				['new-item', false],
			],
		)
		assert.ok(updatedCard.h > initialHeight)

		const longChinese = (await run(tools.upsert_action_card, {
			id: 'long-chinese-actions',
			x: 80,
			y: 640,
			title: '中文长行动项',
			items: [{ id: 'long-zh', text: '确认中文行动项并跟进完整上下文'.repeat(12) }],
		})) as { ok: boolean }
		assert.equal(longChinese.ok, true)
		const chineseCard = store
			.getBoard(canvasId)
			.shapes.find((shape) => shape.id === 'long-chinese-actions')
		assert.ok(chineseCard?.type === 'actions')
		assert.ok(chineseCard.h > 300)

		const empty = (await run(tools.upsert_action_card, {
			id: 'empty-actions',
			x: 500,
			y: 160,
			title: 'No confirmed actions',
			items: [],
		})) as { ok: boolean }
		assert.equal(empty.ok, true)
		const emptyCard = store.getBoard(canvasId).shapes.find((shape) => shape.id === 'empty-actions')
		assert.ok(emptyCard?.type === 'actions')
		assert.deepEqual(emptyCard.items, [])

		await run(tools.add_notes, { notes: [{ id: 'occupied', x: 900, y: 160, text: 'User note' }] })
		const collision = (await run(tools.upsert_action_card, {
			id: 'occupied',
			x: 900,
			y: 160,
			title: 'Do not replace',
			items: [],
		})) as { ok: boolean; error?: string }
		assert.equal(collision.ok, false)
		assert.equal(collision.error, 'DUPLICATE_ID')
		assert.equal(
			store.getBoard(canvasId).shapes.find((shape) => shape.id === 'occupied')?.type,
			'note',
		)

		const schema = tools.upsert_action_card.inputSchema as {
			safeParse(value: unknown): { success: boolean }
		}
		assert.equal(
			schema.safeParse({
				id: 'bad',
				x: 0,
				y: 0,
				title: 'Bad',
				items: [{ id: 'x', text: 'x', done: true }],
			}).success,
			false,
		)
	})
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

test('AI tools add uploaded images and update frame backgrounds', async () => {
	await withStore(async (store) => {
		const imageId = store.saveImage(
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			'image/png',
		)
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		const added = (await run(tools.add_images, {
			images: [{ id: 'photo', imageId, x: 100, y: 100, w: 320, h: 240 }],
		})) as { ok: boolean }
		assert.equal(added.ok, true)
		await run(tools.add_boxes, {
			boxes: [{ id: 'label', x: 430, y: 100, w: 100, h: 80, text: 'Photo' }],
		})
		const framed = await run(tools.add_frames, {
			frames: [
				{
					id: 'hero',
					title: 'Hero',
					memberIds: ['photo', 'label'],
					backgroundImageId: 'photo',
					backgroundFit: 'contain',
				},
			],
		})
		assert.equal((framed as { ok: boolean }).ok, true)
		const board = store.getBoard()
		const frame = board.shapes.find((shape) => shape.id === 'hero')
		assert.ok(frame?.type === 'frame')
		assert.equal(frame.backgroundImageId, 'photo')
		assert.equal(frame.backgroundFit, 'contain')
		const digest = boardDigest(board, [])
		const imageDigest = digest.shapes.find((shape) => shape.id === 'photo')
		assert.equal(imageDigest?.imageId, imageId)
		assert.equal(digest.shapes.find((shape) => shape.id === 'hero')?.backgroundImageId, 'photo')

		const unlinked = (await run(tools.update_shapes, {
			updates: [{ id: 'hero', patch: { backgroundImageId: null } }],
		})) as { ok: boolean }
		assert.equal(unlinked.ok, true)
		const unlinkedFrame = store.getBoard().shapes.find((shape) => shape.id === 'hero')
		assert.ok(unlinkedFrame?.type === 'frame')
		assert.equal(unlinkedFrame.backgroundImageId, undefined)
	})
})

test('AI image mutations reject missing assets and invalid backgrounds without side effects', async () => {
	await withStore(async (store) => {
		const imageId = store.saveImage(
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			'image/png',
		)
		const events: unknown[] = []
		const tools = createCanvasTools({
			store,
			broadcast: (event) => events.push(event),
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})

		await run(tools.add_images, {
			images: [{ id: 'photo', imageId, x: 100, y: 100, w: 320, h: 240 }],
		})
		await run(tools.add_boxes, {
			boxes: [{ id: 'label', x: 500, y: 100, w: 100, h: 80, text: 'Photo' }],
		})
		await run(tools.add_frames, {
			frames: [
				{
					id: 'hero',
					title: 'Hero',
					memberIds: ['photo', 'label'],
					backgroundImageId: 'photo',
					backgroundFit: 'contain',
				},
			],
		})

		const beforeMissing = JSON.stringify(store.getBoard())
		const revisionBeforeMissing = store.getBoard().revision
		const broadcastsBeforeMissing = events.length
		const missing = (await run(tools.add_images, {
			images: [{ id: 'missing-photo', imageId: 'missing-asset', x: 100, y: 500, w: 100, h: 100 }],
		})) as { ok: boolean; error?: string }
		assert.equal(missing.ok, false)
		assert.equal(missing.error, 'MISSING_IMAGE_ASSET')
		assert.equal(JSON.stringify(store.getBoard()), beforeMissing)
		assert.equal(store.getBoard().revision, revisionBeforeMissing)
		assert.equal(events.length, broadcastsBeforeMissing)

		await run(tools.add_boxes, {
			boxes: [
				{ id: 'left', x: 900, y: 100, w: 100, h: 100 },
				{ id: 'right', x: 1100, y: 100, w: 100, h: 100 },
			],
		})
		const beforeInvalid = JSON.stringify(store.getBoard())
		const revisionBeforeInvalid = store.getBoard().revision
		const broadcastsBeforeInvalid = events.length
		const invalid = (await run(tools.add_frames, {
			frames: [
				{
					id: 'invalid-bg',
					title: 'Invalid background',
					memberIds: ['left', 'right'],
					backgroundImageId: 'not-an-image-shape',
				},
			],
		})) as { ok: boolean; error?: string }
		assert.equal(invalid.ok, false)
		assert.equal(JSON.stringify(store.getBoard()), beforeInvalid)
		assert.equal(store.getBoard().revision, revisionBeforeInvalid)
		assert.equal(events.length, broadcastsBeforeInvalid)

		const beforeUpdateInvalid = JSON.stringify(store.getBoard())
		const revisionBeforeUpdateInvalid = store.getBoard().revision
		const broadcastsBeforeUpdateInvalid = events.length
		const invalidUpdate = (await run(tools.update_shapes, {
			updates: [{ id: 'hero', patch: { backgroundImageId: 'not-an-image-shape' } }],
		})) as { ok: boolean; error?: string }
		assert.equal(invalidUpdate.ok, false)
		assert.equal(JSON.stringify(store.getBoard()), beforeUpdateInvalid)
		assert.equal(store.getBoard().revision, revisionBeforeUpdateInvalid)
		assert.equal(events.length, broadcastsBeforeUpdateInvalid)

		const revisionBeforeDelete = store.getBoard().revision
		const deleteReply = (await run(tools.delete_shapes, { ids: ['photo'] })) as {
			ok: boolean
		}
		assert.equal(deleteReply.ok, true)
		assert.equal(store.getBoard().revision, revisionBeforeDelete + 1)
		const hero = store.getBoard().shapes.find((shape) => shape.id === 'hero')
		assert.ok(hero?.type === 'frame')
		assert.equal(hero.backgroundImageId, undefined)
		assert.ok(events.length > broadcastsBeforeInvalid)
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

test('lecture instructions tell the model to wait on incomplete sentences', () => {
	const prompt = buildInstructions({ revision: 0, shapes: [] }, [], 'lecture')
	assert.match(prompt, /Live session mode/)
	assert.match(prompt, /reply with exactly WAIT/)
	assert.match(prompt, /text-only WAIT reply is correct/)
	assert.match(prompt, /Do not guess the rest of the sentence/)
	assert.doesNotMatch(buildInstructions({ revision: 0, shapes: [] }, []), /Live session mode/)
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
	providedModel?: MockLanguageModelV4,
) {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-http-'))
	const model = providedModel ?? createMockAiModel()
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'ai-settings', 'settings.json'),
		env: {},
		aiModel: model,
	})
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
	const address = daemon.server.address()
	assert.ok(address && typeof address !== 'string')
	try {
		await runTest({
			daemon,
			url: `http://127.0.0.1:${address.port}`,
			model: model as ReturnType<typeof createMockAiModel>,
		})
	} finally {
		for (const client of daemon.wss.clients) client.terminate()
		await daemon.close()
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
		assert.deepEqual(model.doStreamCalls[0]?.providerOptions, {
			magpie: { reasoningEffort: 'low' },
		})
		const firstPrompt = JSON.stringify(model.doStreamCalls[0]?.prompt)
		assert.match(firstPrompt, /selected-seed/)
		assert.match(firstPrompt, /primary context/)
		const shapes = daemon.store.getBoard().shapes
		assert.equal(shapes.length, 9)
		assert.ok(shapes.some((shape) => shape.id === 'mock-1-title'))
		assert.ok(shapes.some((shape) => shape.id === 'mock-1-flow' && shape.type === 'connector'))
	})
})

test('post-session summary writes a reusable HTML card and preserves action completion', async () => {
	const usage = {
		inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
		outputTokens: { total: 10, text: 10, reasoning: undefined },
	}
	let step = 0
	const model = new MockLanguageModelV4({
		doStream: async () => {
			const phase = step++ % 3
			const name = phase === 0 ? 'add_html_cards' : 'upsert_action_card'
			const input = JSON.stringify(
				phase === 0
					? {
							cards: [
								{
									id: 'summary',
									x: 800,
									y: 120,
									w: 620,
									h: 400,
									title: 'Plan',
									html: '<h1>Plan</h1>',
								},
							],
						}
					: {
							id: 'actions',
							x: 1460,
							y: 120,
							title: 'Next steps',
							items: [{ id: 'timeline', text: 'Confirm the timeline' }],
						},
			)
			const callId = `summary-step-${step}`
			return {
				stream: simulateReadableStream({
					chunks: [
						{ type: 'stream-start' as const, warnings: [] },
						...(phase === 2
							? []
							: [
									{ type: 'tool-input-start' as const, id: callId, toolName: name },
									{ type: 'tool-input-delta' as const, id: callId, delta: input },
									{ type: 'tool-input-end' as const, id: callId },
									{ type: 'tool-call' as const, toolCallId: callId, toolName: name, input },
								]),
						{
							type: 'finish' as const,
							finishReason: {
								unified: phase === 2 ? ('stop' as const) : ('tool-calls' as const),
								raw: undefined,
							},
							usage,
						},
					],
				}),
			}
		},
	})
	await withDaemon(async ({ daemon, url }) => {
		const summarize = async () => {
			const response = await fetch(`${url}/api/ai/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					messages: [
						{
							id: 'u',
							role: 'user',
							parts: [
								{
									type: 'text',
									text: `We will confirm the timeline. ${POST_SESSION_SUMMARY_PROMPT}`,
								},
							],
						},
					],
					selection: [],
				}),
			})
			assert.equal(response.status, 200)
			const stream = await response.text()
			assert.match(stream, /add_html_cards/)
			assert.match(stream, /upsert_action_card/)
		}
		await summarize()
		const initial = daemon.store.getBoard()
		assert.ok(initial.shapes.some((shape) => shape.id === 'summary' && shape.type === 'html'))
		assert.equal(initial.shapes.find((shape) => shape.id === 'actions')?.type, 'actions')
		daemon.store.applyRequest({
			expectedRevision: initial.revision,
			operations: [{ type: 'set_action_done', id: 'actions', itemId: 'timeline', done: true }],
		})
		await summarize()
		const shapes = daemon.store.getBoard().shapes
		assert.equal(shapes.filter((shape) => shape.id === 'summary').length, 1)
		const action = shapes.find((shape) => shape.id === 'actions')
		if (action?.type !== 'actions') throw new Error('Missing action card')
		assert.deepEqual(action.items, [{ id: 'timeline', text: 'Confirm the timeline', done: true }])
	}, model)
})

test('AI settings updates create the model used by subsequent chats', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-settings-chat-'))
	const seen: Array<{ baseURL: string; model: string; apiKey: string }> = []
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'ai-settings', 'settings.json'),
		env: {},
		createAiModel: (settings) => {
			seen.push(settings)
			return createMockAiModel()
		},
	})
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
	const address = daemon.server.address()
	assert.ok(address && typeof address !== 'string')
	try {
		const url = `http://127.0.0.1:${address.port}`
		const put = await fetch(`${url}/api/ai/settings`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				baseURL: 'https://chat.example/v1',
				model: 'chat-model',
				apiKey: 'chat-secret',
			}),
		})
		assert.equal(put.status, 200)

		const chat = await fetch(`${url}/api/ai/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Draw' }] }],
			}),
		})
		assert.equal(chat.status, 200)
		await chat.text()
		assert.deepEqual(seen.at(-1), {
			baseURL: 'https://chat.example/v1',
			model: 'chat-model',
			apiKey: 'chat-secret',
		})
	} finally {
		for (const client of daemon.wss.clients) client.terminate()
		await daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
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

		const badMode = await fetch(`${url}/api/ai/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
				mode: 'podcast',
			}),
		})
		assert.equal(badMode.status, 400)
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

test('update_shapes validates palette colors and normalizes notes only', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_notes, {
			notes: [
				{ id: 'pale-note', x: 10, y: 10, text: 'Pale' },
				{ id: 'vivid-note', x: 300, y: 10, text: 'Vivid' },
			],
		})
		await run(tools.add_boxes, {
			boxes: [
				{ id: 'vivid-box', x: 590, y: 10, w: 160, h: 100, text: 'Vivid box' },
				{ id: 'pale-box', x: 780, y: 10, w: 160, h: 100, text: 'Pale box' },
			],
		})
		const inputSchema = tools.update_shapes.inputSchema as { parse(input: unknown): unknown }
		const input = inputSchema.parse({
			updates: [
				{ id: 'pale-note', patch: { color: CANDY_TINTS.blue } },
				{ id: 'vivid-note', patch: { color: CANDY_COLORS.pink } },
				{ id: 'vivid-box', patch: { color: CANDY_COLORS.green } },
				{ id: 'pale-box', patch: { color: CANDY_TINTS.pink } },
			],
		})
		const revision = store.getBoard().revision
		const reply = (await run(tools.update_shapes, input)) as { ok: boolean; revision: number }
		assert.equal(reply.ok, true)
		assert.equal(reply.revision, revision + 1)
		const shapes = store.getBoard().shapes
		assert.equal(shapes.find((shape) => shape.id === 'pale-note')?.color, CANDY_TINTS.blue)
		assert.equal(shapes.find((shape) => shape.id === 'vivid-note')?.color, CANDY_TINTS.pink)
		assert.equal(shapes.find((shape) => shape.id === 'vivid-box')?.color, CANDY_COLORS.green)
		assert.equal(shapes.find((shape) => shape.id === 'pale-box')?.color, CANDY_TINTS.pink)

		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'external',
						type: 'text',
						x: 980,
						y: 10,
						w: 100,
						h: 40,
						text: 'External',
						color: CANDY_COLORS.ink,
						font: 'sans',
						fontSize: 20,
						fontWeight: 500,
					},
				},
			],
		})
		const beforeConflict = JSON.stringify(store.getBoard())
		const conflict = (await run(tools.update_shapes, input)) as { ok: boolean; error?: string }
		assert.equal(conflict.ok, false)
		assert.equal(conflict.error, 'REVISION_CONFLICT')
		assert.equal(JSON.stringify(store.getBoard()), beforeConflict)
	})
})

test('unrelated creates cannot acknowledge unread concurrent edits', async () => {
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

		const added = (await run(tools.add_notes, {
			notes: [{ id: 'unread', x: 600, y: 10, text: 'Unrelated addition' }],
		})) as { ok: boolean; revision: number }
		assert.equal(added.ok, true)
		assert.equal(added.revision, store.getBoard().revision)
		const retried = (await run(tools.update_shapes, {
			updates: [{ id: 'label', patch: { text: 'After' } }],
		})) as { ok: boolean; error?: string }
		assert.equal(retried.error, 'REVISION_CONFLICT')
		await run(tools.get_board, {})
		const refreshed = (await run(tools.update_shapes, {
			updates: [{ id: 'label', patch: { text: 'After' } }],
		})) as { ok: boolean }
		assert.equal(refreshed.ok, true)
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

test('lecture mode can answer WAIT without forcing a tool call', async () => {
	const usage = {
		inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
		outputTokens: { total: 2, text: 2, reasoning: undefined },
	}
	const model = new MockLanguageModelV4({
		doStream: async () => ({
			stream: simulateReadableStream({
				chunks: [
					{ type: 'stream-start' as const, warnings: [] },
					{ type: 'text-start' as const, id: 'text-1' },
					{ type: 'text-delta' as const, id: 'text-1', delta: 'WAIT' },
					{ type: 'text-end' as const, id: 'text-1' },
					{
						type: 'finish' as const,
						finishReason: { unified: 'stop' as const, raw: undefined },
						usage,
					},
				],
			}),
		}),
	})
	await withDaemon(async ({ daemon, url }) => {
		const response = await fetch(`${url}/api/ai/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				mode: 'lecture',
				messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'half a sentence' }] }],
				selection: [],
			}),
		})
		assert.equal(response.status, 200)
		const streamed = await response.text()
		assert.match(streamed, /WAIT/)
		assert.deepEqual(model.doStreamCalls[0]?.providerOptions, {
			magpie: { reasoningEffort: 'none' },
		})
		assert.equal(daemon.store.getBoard().shapes.length, 0)
	}, model)
})

test('board digests warn about overlaps and frame escapes', () => {
	const board = {
		revision: 1,
		shapes: [
			{
				id: 'frame',
				type: 'frame' as const,
				x: 0,
				y: 0,
				w: 400,
				h: 300,
				color: '#00a2e1',
				title: 'Frame',
			},
			{
				id: 'a',
				type: 'note' as const,
				x: 20,
				y: 20,
				w: 200,
				h: 120,
				color: '#fff8d4',
				frameId: 'frame',
			},
			{
				id: 'b',
				type: 'note' as const,
				x: 60,
				y: 40,
				w: 200,
				h: 120,
				color: '#ffe9f0',
				frameId: 'frame',
			},
			{
				id: 'outside',
				type: 'note' as const,
				x: 360,
				y: 240,
				w: 200,
				h: 120,
				color: '#f1fadc',
				frameId: 'frame',
			},
		],
	}
	const digest = boardDigest(board, [])
	assert.ok(digest.warnings.some((warning) => warning.includes('a overlaps b')))
	assert.ok(digest.warnings.some((warning) => warning.includes('outside is outside its frame')))
})

test('re-creating an existing id updates it instead of failing', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_notes, {
			notes: [{ id: 'risks', x: 10, y: 10, text: 'First version' }],
		})
		const reply = (await run(tools.add_notes, {
			notes: [{ id: 'risks', x: 10, y: 10, text: 'Second version' }],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const notes = store.getBoard().shapes.filter((shape) => shape.id === 'risks')
		assert.equal(notes.length, 1)
		assert.equal(notes[0].type === 'note' ? notes[0].text : null, 'Second version')
	})
})

test('same-batch duplicate ids collapse into one object', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		const reply = (await run(tools.add_notes, {
			notes: [
				{ id: 'same', x: 10, y: 10, text: 'First' },
				{ id: 'same', x: 10, y: 10, text: 'Second' },
			],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const notes = store.getBoard().shapes.filter((shape) => shape.id === 'same')
		assert.equal(notes.length, 1)
		assert.equal(notes[0].type === 'note' ? notes[0].text : null, 'Second')
	})
})

test('connector upserts reset anchors when endpoints change', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_boxes, {
			boxes: [
				{ id: 'a', x: 10, y: 10, w: 100, h: 60 },
				{ id: 'b', x: 300, y: 10, w: 100, h: 60 },
			],
		})
		await run(tools.add_connectors, {
			connectors: [{ id: 'link', from: 'a', to: 'b', fromAnchor: 11 }],
		})
		await run(tools.add_lines, {
			lines: [{ id: 'line', from: { x: 10, y: 200 }, to: { x: 200, y: 200 } }],
		})
		const reply = (await run(tools.add_connectors, {
			connectors: [{ id: 'link', from: 'line', to: 'b' }],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const link = store.getBoard().shapes.find((shape) => shape.id === 'link')
		assert.equal(link?.type === 'connector' ? link.from : null, 'line')
		assert.equal(link?.type === 'connector' ? link.fromAnchor : 'missing', undefined)
	})
})

test('add_frames computes padded bounds and attaches every member atomically', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_boxes, {
			boxes: [
				{ id: 'a', x: 100, y: 100, w: 200, h: 120 },
				{ id: 'b', kind: 'ellipse', x: 400, y: 250, w: 100, h: 80 },
			],
		})
		const reply = (await run(tools.add_frames, {
			frames: [{ id: 'lesson', title: 'Lesson', memberIds: ['a', 'b'] }],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const frame = store.getBoard().shapes.find((shape) => shape.id === 'lesson')
		assert.ok(frame && frame.type === 'frame')
		assert.equal(frame.x, 60)
		assert.equal(frame.y, 60)
		assert.equal(frame.w, 480)
		assert.equal(frame.h, 310)
		for (const memberId of ['a', 'b']) {
			const member = store.getBoard().shapes.find((shape) => shape.id === memberId)
			assert.ok(member && member.type !== 'connector')
			assert.equal(member.frameId, 'lesson')
		}
	})
})

test('add_frames accepts off-screen and signed-line geometry', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_lines, {
			lines: [{ id: 'signed', from: { x: 2500, y: 3500 }, to: { x: 2300, y: 3300 } }],
		})
		await run(tools.add_notes, {
			notes: [{ id: 'outside', x: 2600, y: 3600, w: 300, h: 200, text: 'Far away' }],
		})
		const reply = (await run(tools.add_frames, {
			frames: [{ id: 'far', title: 'Far', memberIds: ['signed', 'outside'] }],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const frame = store.getBoard().shapes.find((shape) => shape.id === 'far')
		assert.ok(frame && frame.type === 'frame')
		assert.equal(frame.x, 2260)
		assert.equal(frame.y, 3260)
		assert.equal(frame.w, 680)
		assert.equal(frame.h, 580)
	})
})

test('add_frames rejects invalid membership and frame id collisions without mutation', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_notes, {
			notes: [{ id: 'a', x: 100, y: 100, text: 'A' }],
		})
		await run(tools.add_boxes, {
			boxes: [{ id: 'b', x: 400, y: 100, w: 100, h: 100 }],
		})
		const missing = (await run(tools.add_frames, {
			frames: [{ id: 'missing-frame', title: 'Missing', memberIds: ['a', 'ghost'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(missing.ok, false)
		assert.equal(missing.error, 'NOT_FOUND')

		const collisionId = (await run(tools.add_frames, {
			frames: [{ id: 'a', title: 'Collision', memberIds: ['a', 'b'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(collisionId.ok, false)
		assert.equal(collisionId.error, 'DUPLICATE_ID')
		assert.equal(
			store.getBoard().shapes.some((shape) => shape.type === 'frame'),
			false,
		)
	})
})

test('add_frames rejects unrelated overlap and already framed members', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_boxes, {
			boxes: [
				{ id: 'a', x: 100, y: 100, w: 100, h: 100 },
				{ id: 'b', x: 500, y: 100, w: 100, h: 100 },
				{ id: 'unrelated', x: 200, y: 120, w: 100, h: 100 },
			],
		})
		const reply = (await run(tools.add_frames, {
			frames: [{ id: 'blocked', title: 'Blocked', memberIds: ['a', 'b'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(reply.ok, false)
		assert.equal(reply.error, 'FRAME_COLLISION')
		assert.equal(
			store.getBoard().shapes.some((shape) => shape.type === 'frame'),
			false,
		)

		await run(tools.delete_shapes, {
			ids: ['unrelated'],
		})
		await run(tools.add_frames, {
			frames: [{ id: 'first', title: 'First', memberIds: ['a', 'b'] }],
		})
		await run(tools.add_boxes, {
			boxes: [{ id: 'c', x: 700, y: 100, w: 100, h: 100 }],
		})
		const framed = (await run(tools.add_frames, {
			frames: [{ id: 'second', title: 'Second', memberIds: ['a', 'c'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(framed.ok, false)
		assert.equal(framed.error, 'FRAME_MEMBER')
	})
})

test('explicit frame membership grows in a batched update and never shrinks', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_boxes, {
			boxes: [
				{ id: 'a', x: 100, y: 100, w: 100, h: 100 },
				{ id: 'b', x: 400, y: 100, w: 100, h: 100 },
				{ id: 'c', x: 800, y: 100, w: 100, h: 100 },
			],
		})
		await run(tools.add_frames, {
			frames: [{ id: 'frame', title: 'Frame', memberIds: ['a', 'b'] }],
		})
		const reply = (await run(tools.update_shapes, {
			updates: [
				{ id: 'b', patch: { x: 650 } },
				{ id: 'c', patch: { frameId: 'frame' } },
			],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const frame = store.getBoard().shapes.find((shape) => shape.id === 'frame')
		assert.ok(frame && frame.type === 'frame')
		assert.equal(frame.x, 60)
		assert.equal(frame.y, 60)
		assert.equal(frame.w, 880)
		assert.equal(frame.h, 180)
		for (const memberId of ['a', 'b', 'c']) {
			const member = store.getBoard().shapes.find((shape) => shape.id === memberId)
			assert.ok(member && member.type !== 'connector')
			assert.equal(member.frameId, 'frame')
		}
	})
})

test('growth rejects collision atomically and stale revisions', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_boxes, {
			boxes: [
				{ id: 'a', x: 100, y: 100, w: 100, h: 100 },
				{ id: 'b', x: 400, y: 100, w: 100, h: 100 },
				{ id: 'human', x: 700, y: 100, w: 100, h: 100 },
			],
		})
		await run(tools.add_frames, {
			frames: [{ id: 'frame', title: 'Frame', memberIds: ['a', 'b'] }],
		})
		const frameBefore = store.getBoard().shapes.find((shape) => shape.id === 'frame')
		const collision = (await run(tools.update_shapes, {
			updates: [{ id: 'a', patch: { x: 600 } }],
		})) as { ok: boolean; error?: string }
		assert.equal(collision.ok, false)
		assert.equal(collision.error, 'FRAME_COLLISION')
		const frameAfter = store.getBoard().shapes.find((shape) => shape.id === 'frame')
		assert.deepEqual(frameAfter, frameBefore)
		const movedA = store.getBoard().shapes.find((shape) => shape.id === 'a')
		assert.equal(movedA?.type === 'ellipse' || movedA?.type === 'rectangle' ? movedA.x : null, 100)

		store.applyRequest({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'external',
						type: 'note',
						x: 900,
						y: 900,
						w: 100,
						h: 100,
						color: '#fff8d4',
						text: 'External',
					},
				},
			],
			canvasId: store.getActiveCanvasId(),
		})
		const stale = (await run(tools.update_shapes, {
			updates: [{ id: 'b', patch: { x: 650 } }],
		})) as { ok: boolean; error?: string }
		assert.equal(stale.ok, false)
		assert.equal(stale.error, 'REVISION_CONFLICT')
		const b = store.getBoard().shapes.find((shape) => shape.id === 'b')
		assert.ok(b && b.type !== 'connector')
		assert.equal(b.x, 400)
	})
})

test('multiple frame batches and frame nesting are rejected safely', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		await run(tools.add_boxes, {
			boxes: [
				{ id: 'a', x: 100, y: 100, w: 100, h: 100 },
				{ id: 'b', x: 300, y: 100, w: 100, h: 100 },
				{ id: 'c', x: 700, y: 100, w: 100, h: 100 },
				{ id: 'd', x: 900, y: 100, w: 100, h: 100 },
			],
		})
		const reply = (await run(tools.add_frames, {
			frames: [
				{ id: 'left', title: 'Left', memberIds: ['a', 'b'] },
				{ id: 'right', title: 'Right', memberIds: ['c', 'd'] },
			],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		assert.equal(store.getBoard().shapes.filter((shape) => shape.type === 'frame').length, 2)

		await run(tools.add_boxes, {
			boxes: [
				{ id: 'e', x: 120, y: 120, w: 100, h: 100 },
				{ id: 'f', x: 820, y: 120, w: 100, h: 100 },
			],
		})
		const nested = (await run(tools.add_frames, {
			frames: [{ id: 'nested', title: 'Nested', memberIds: ['e', 'f'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(nested.ok, false)
		assert.equal(nested.error, 'FRAME_COLLISION')
	})
})

test('AI HTML cards embed Lucide icons and expose full markup for later updates', async () => {
	await withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		const created = (await run(tools.add_html_cards, {
			cards: [
				{
					id: 'summary',
					title: 'Summary',
					x: 80,
					y: 200,
					w: 1200,
					h: 800,
					html: '<i data-lucide="heart-pulse"></i>',
				},
			],
		})) as { ok: boolean }
		assert.equal(created.ok, true)
		const detail = (await run(tools.get_board, { ids: ['summary'], include_html: true })) as {
			shapes: { html: string }[]
		}
		assert.match(detail.shapes[0].html, /<svg[^>]*lucide-heart-pulse/)
		const updated = (await run(tools.update_shapes, {
			updates: [{ id: 'summary', patch: { html: '<i data-lucide="clipboard-list"></i>' } }],
		})) as { ok: boolean }
		assert.equal(updated.ok, true)
		const card = store.getBoard().shapes.find((shape) => shape.id === 'summary')
		assert.ok(card?.type === 'html')
		assert.match(card.html ?? '', /<svg[^>]*lucide-clipboard-list/)
	})
})
