import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { Chat } from '@ai-sdk/react'
import { DefaultChatTransport, simulateReadableStream, type UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { createMagpieModel } from '../src/server/ai.ts'
import * as aiBoardMod from '../src/server/aiBoard.ts'
import { loadAiConfig, loadRuntimeEnv } from '../src/server/aiConfig.ts'
import * as aiPromptMod from '../src/server/aiPrompt.ts'
import * as aiToolsMod from '../src/server/aiTools.ts'
import { createDaemon } from '../src/server/index.ts'
import { BoardStore, LOCAL_TENANT } from '../src/server/store.ts'
import { POST_SESSION_SUMMARY_PROMPT } from '../src/shared/summaryPrompt.ts'
import type { Board, CanvasShape, Shape } from '../src/shared/types.ts'
import * as protocolMod from '../src/web/frame/assistant/protocol.ts'
import * as micVmMod from '../src/web/frame/assistant/useMicrophoneViewModel.ts'
import { htmlCardDocument } from '../src/web/htmlCard.ts'
import { lectureSegmentText } from '../src/web/stt/transcript.ts'
import { SilenceSegmenter } from '../src/web/stt/vad.ts'

export type EvalLayerId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

export interface CaseRubric {
	id: string
	lang: 'zh' | 'en'
	subject: string
	title: string
	file: string
	kind: 'single-topic' | 'multi-topic'
	expectedTopics: string[]
	revisitedTopics: string[]
	expectedExecutiveCard: boolean
	minTopicCards: number
	maxTopicCards: number
	minActionItems: number
	keyFacts: string[]
}

export interface LayeredEvalSuite {
	version: number
	layers: { id: EvalLayerId; name: string; targets: Record<string, unknown> }[]
	cases: CaseRubric[]
}

export interface L1ToolMetrics {
	allToolsCount: number
	allToolsSchemaBytes: number
	activeChatNoImageToolCount: number
	activeChatNoImageSchemaBytes: number
	activeLectureNoImageToolCount: number
	activeLectureNoImageSchemaBytes: number
	perToolSchemaBytes: Record<string, number>
	parallelChainSucceeded: boolean
	geometryReceiptPresent: boolean
	htmlCardRuntimeCssInjected: boolean
}

export interface L2BoardAndCacheMetrics {
	staticChatPromptBytes: number
	staticLecturePromptBytes: number
	postSessionPromptBytes: number
	systemPromptTurn1Bytes: number
	systemPromptTurn2Bytes: number
	systemPromptInvariantAcrossRevisions: boolean
	boardContext50ShapesBytes: number
	boardContext180ShapesBytes: number
	anchorsRetainedAt180Shapes: boolean
}

export interface L3CompactionMetrics {
	turn20ModelBytes: number
	turn60ModelBytes: number
	turn100ModelBytes: number | null
	turn105AcceptedWithoutHttp400: boolean
	turn120AcceptedWithoutHttp400: boolean
	turn120WireBytes: number
	turn120ModelBytes: number | null
	turn100CacheablePrefixRatio: number
	turn120CacheablePrefixRatio: number | null
}

export interface L4SttAndQueueMetrics {
	c14SegmentCount: number
	liveMicDefaultSilenceMs: number
	audioPlaybackDefaultSilenceMs: number
	coalescedFillerCount: number
	dispatchedBatchCount: number
	maxQueueDepth: number
	p95DrawingLagMs: number
	summaryRecoveredAfterLectureError: boolean
}

export interface L5PromptMetrics {
	promptAllowsMultipleTopicCards: boolean
	promptDefinesTopicTransitionTrigger: boolean
	promptNoSingletonSummaryLock: boolean
	promptRequiresConditionalExecutiveCard: boolean
}

export interface LayeredEvalReport {
	generatedAt: string
	L1?: L1ToolMetrics
	L2?: L2BoardAndCacheMetrics
	L3?: L3CompactionMetrics
	L4?: L4SttAndQueueMetrics
	L5?: L5PromptMetrics
}

export interface BoardRubricEvaluation {
	caseId: string
	passed: boolean
	swimlaneFrames: number
	topicCards: number
	duplicateTopicCards: number
	executiveSummaryCards: number
	executiveCardMatch: boolean
	actionCards: number
	actionItems: number
	topicCoverageRatio: number
	keyFactMatchRatio: number
	overlapPairs: number
	frameOverlapPairs: number
	outsideFrameShapes: number
	reasons: string[]
}

export interface ParsedEvalCliArgs {
	layer: 'all' | EvalLayerId
	json: boolean
	live: boolean
	confirmProviderUsage: boolean
	caseId?: string
}

const VALID_LAYERS = new Set(['all', 'L1', 'L2', 'L3', 'L4', 'L5'])

export function parseEvalCliArgs(argv: readonly string[]): ParsedEvalCliArgs {
	let layer: 'all' | EvalLayerId = 'all'
	let json = false
	let live = false
	let confirmProviderUsage = false
	let caseId: string | undefined

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === '--json') {
			json = true
		} else if (arg === '--live') {
			live = true
		} else if (arg === '--confirm-provider-usage') {
			confirmProviderUsage = true
		} else if (arg === '--layer') {
			const next = argv[++index]
			if (!next || !VALID_LAYERS.has(next)) {
				throw new Error('--layer must be one of all, L1, L2, L3, L4, L5')
			}
			layer = next as 'all' | EvalLayerId
		} else if (arg.startsWith('--layer=')) {
			const next = arg.slice('--layer='.length)
			if (!VALID_LAYERS.has(next)) {
				throw new Error('--layer must be one of all, L1, L2, L3, L4, L5')
			}
			layer = next as 'all' | EvalLayerId
		} else if (arg === '--case') {
			caseId = argv[++index]
			if (!caseId) throw new Error('--case requires a case id')
		} else if (arg.startsWith('--case=')) {
			caseId = arg.slice('--case='.length)
			if (!caseId) throw new Error('--case requires a case id')
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	if (live && !confirmProviderUsage) {
		throw new Error(
			'Pass --confirm-provider-usage together with --live before calling an AI gateway',
		)
	}

	return { layer, json, live, confirmProviderUsage, caseId }
}

export function loadLayeredEvalSuite(
	path = 'evals/cases/layered-eval-suite.json',
): LayeredEvalSuite {
	return JSON.parse(readFileSync(path, 'utf8')) as LayeredEvalSuite
}

function splitSentences(text: string, lang: 'zh' | 'en'): string[] {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
	if (lines.length >= 10) return lines
	const normal = text.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
	if (!normal) return []
	const segmenter = new Intl.Segmenter(lang === 'zh' ? 'zh-CN' : 'en-US', {
		granularity: 'sentence',
	})
	return [...segmenter.segment(normal)].map((part) => part.segment.trim()).filter(Boolean)
}

interface Rect {
	x: number
	y: number
	w: number
	h: number
}

function rectOf(shape: Shape): Rect | null {
	if (shape.type === 'connector') return null
	return {
		x: Math.min(shape.x, shape.x + shape.w),
		y: Math.min(shape.y, shape.y + shape.h),
		w: Math.abs(shape.w),
		h: Math.abs(shape.h),
	}
}

function overlapRatio(a: Rect, b: Rect): number {
	const left = Math.max(a.x, b.x)
	const top = Math.max(a.y, b.y)
	const right = Math.min(a.x + a.w, b.x + b.w)
	const bottom = Math.min(a.y + a.h, b.y + b.h)
	if (right <= left || bottom <= top) return 0
	const area = (right - left) * (bottom - top)
	const minArea = Math.min(a.w * a.h, b.w * b.h)
	return minArea > 0 ? area / minArea : 0
}

function containsRect(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x - 1 &&
		inner.y >= outer.y - 1 &&
		inner.x + inner.w <= outer.x + outer.w + 1 &&
		inner.y + inner.h <= outer.y + outer.h + 1
	)
}

function isExecutiveCard(shape: CanvasShape): boolean {
	if (shape.type !== 'html') return false
	if (/^executive[-_]/i.test(shape.id)) return true
	const title = shape.title ?? ''
	return /executive overview|总览|全局总览|会议总览/i.test(title)
}

export function evaluateBoardAgainstRubric(
	board: Board,
	rubric: CaseRubric,
): BoardRubricEvaluation {
	const shapes = board.shapes
	const rects = new Map<string, Rect>()
	for (const shape of shapes) {
		const rect = rectOf(shape)
		if (rect) rects.set(shape.id, rect)
	}

	const frames = shapes.filter((shape): shape is CanvasShape => shape.type === 'frame')
	const htmlCards = shapes.filter((shape): shape is CanvasShape => shape.type === 'html')
	const execCards = htmlCards.filter((card) => isExecutiveCard(card))
	const topicCardList = htmlCards.filter((card) => !isExecutiveCard(card))
	const actionCards = shapes.filter((shape): shape is CanvasShape => shape.type === 'actions')
	const actionItems = actionCards.reduce((total, card) => total + (card.items?.length ?? 0), 0)

	const seenTopics = new Set<string>()
	let duplicateTopicCards = 0
	for (const card of topicCardList) {
		const key = (card.title ?? card.id).trim().toLowerCase()
		if (seenTopics.has(key)) duplicateTopicCards++
		else seenTopics.add(key)
	}

	const expectedCount = Math.max(1, rubric.expectedTopics.length)
	const topicCoverageRatio = Math.min(1, topicCardList.length / expectedCount)
	const executiveCardMatch = rubric.expectedExecutiveCard
		? execCards.length === 1
		: execCards.length === 0

	const content = shapes.filter((shape) =>
		['rectangle', 'ellipse', 'note', 'html', 'actions'].includes(shape.type),
	)
	let overlapPairs = 0
	for (let i = 0; i < content.length; i++) {
		for (let j = i + 1; j < content.length; j++) {
			const a = rects.get(content[i].id)
			const b = rects.get(content[j].id)
			if (a && b && overlapRatio(a, b) > 0.35) overlapPairs++
		}
	}

	let frameOverlapPairs = 0
	for (let i = 0; i < frames.length; i++) {
		for (let j = i + 1; j < frames.length; j++) {
			const a = rects.get(frames[i].id)
			const b = rects.get(frames[j].id)
			if (a && b && overlapRatio(a, b) > 0.05) frameOverlapPairs++
		}
	}

	const frameRects = new Map(frames.map((frame) => [frame.id, rects.get(frame.id)]))
	let outsideFrameShapes = 0
	for (const shape of shapes) {
		if (shape.type === 'connector' || !shape.frameId) continue
		const outer = frameRects.get(shape.frameId)
		const inner = rects.get(shape.id)
		if (!outer || !inner || !containsRect(outer, inner)) outsideFrameShapes++
	}

	const corpus = shapes
		.map((shape) =>
			shape.type === 'connector'
				? ''
				: [
						shape.text ?? '',
						shape.title ?? '',
						shape.label ?? '',
						shape.html ?? '',
						...(shape.items?.map((item) => item.text) ?? []),
					].join(' '),
		)
		.join(' ')
		.toLowerCase()
	const matchedFacts = rubric.keyFacts.filter((fact) => corpus.includes(fact.toLowerCase()))
	const keyFactMatchRatio =
		rubric.keyFacts.length > 0 ? matchedFacts.length / rubric.keyFacts.length : 1

	const reasons: string[] = []
	if (topicCardList.length < rubric.minTopicCards) {
		reasons.push(
			`Expected at least ${rubric.minTopicCards} topic cards, got ${topicCardList.length}`,
		)
	}
	if (topicCardList.length > rubric.maxTopicCards) {
		reasons.push(
			`Expected at most ${rubric.maxTopicCards} topic cards, got ${topicCardList.length}`,
		)
	}
	if (duplicateTopicCards > 0) reasons.push(`Duplicate topic cards: ${duplicateTopicCards}`)
	if (!executiveCardMatch) {
		reasons.push(
			`Executive summary count mismatch: expected ${rubric.expectedExecutiveCard ? 1 : 0}, got ${execCards.length}`,
		)
	}
	if (actionItems < rubric.minActionItems) {
		reasons.push(`Expected at least ${rubric.minActionItems} action items, got ${actionItems}`)
	}
	if (overlapPairs > 0) reasons.push(`Content overlaps: ${overlapPairs}`)
	if (frameOverlapPairs > 0) reasons.push(`Frame overlaps: ${frameOverlapPairs}`)
	if (outsideFrameShapes > 0) reasons.push(`Outside-frame shapes: ${outsideFrameShapes}`)

	return {
		caseId: rubric.id,
		passed: reasons.length === 0,
		swimlaneFrames: frames.length,
		topicCards: topicCardList.length,
		duplicateTopicCards,
		executiveSummaryCards: execCards.length,
		executiveCardMatch,
		actionCards: actionCards.length,
		actionItems,
		topicCoverageRatio: Number(topicCoverageRatio.toFixed(2)),
		keyFactMatchRatio: Number(keyFactMatchRatio.toFixed(2)),
		overlapPairs,
		frameOverlapPairs,
		outsideFrameShapes,
		reasons,
	}
}

const stopUsage = {
	inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 4, text: 4, reasoning: undefined },
}

function stopModel(onCall?: (options: LanguageModelV4CallOptions) => void): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		provider: 'eval-mock',
		modelId: 'eval-mock',
		doStream: async (options) => {
			onCall?.(options)
			const mustCallTool = options.toolChoice?.type === 'required'
			if (mustCallTool) {
				const input = '{}'
				return {
					stream: simulateReadableStream({
						chunks: [
							{ type: 'stream-start', warnings: [] },
							{ type: 'tool-input-start', id: 'c1', toolName: 'get_board' },
							{ type: 'tool-input-delta', id: 'c1', delta: input },
							{ type: 'tool-input-end', id: 'c1' },
							{ type: 'tool-call', toolCallId: 'c1', toolName: 'get_board', input },
							{
								type: 'finish',
								finishReason: { unified: 'tool-calls', raw: undefined },
								usage: stopUsage,
							},
						],
					}),
				}
			}
			return {
				stream: simulateReadableStream({
					chunks: [
						{ type: 'stream-start', warnings: [] },
						{ type: 'text-start', id: 't1' },
						{ type: 'text-delta', id: 't1', delta: 'WAIT' },
						{ type: 'text-end', id: 't1' },
						{
							type: 'finish',
							finishReason: { unified: 'stop', raw: undefined },
							usage: stopUsage,
						},
					],
				}),
			}
		},
	})
}

async function withEvalDaemon(
	model: MockLanguageModelV4,
	run: (url: string, store: ReturnType<BoardStore['forTenant']>) => Promise<void>,
): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-eval-'))
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
	if (!address || typeof address === 'string') throw new Error('Invalid eval daemon port')
	try {
		await run(`http://127.0.0.1:${address.port}`, daemon.store)
	} finally {
		for (const client of daemon.wss.clients) client.terminate()
		await daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

type ToolExecutor = (input: unknown, opts: unknown) => Promise<unknown>

function execTool(tool: unknown, input: unknown, toolCallId: string): Promise<unknown> {
	return (tool as unknown as { execute: ToolExecutor }).execute(input, { toolCallId, messages: [] })
}

async function measureL1Tools(): Promise<L1ToolMetrics> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-eval-l1-'))
	const boardStore = new BoardStore(join(directory, 'board.sqlite'))
	const store = boardStore.forTenant(LOCAL_TENANT)
	try {
		const canvasId = await store.getActiveCanvasId()
		const tools = await aiToolsMod.createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId,
		})
		const perToolSchemaBytes: Record<string, number> = {}
		let allToolsSchemaBytes = 0
		for (const [name, tool] of Object.entries(tools)) {
			const record = tool as unknown as { description?: string; inputSchema: z.ZodType }
			const parameters = z.toJSONSchema(record.inputSchema, {
				target: 'draft-7',
				io: 'input',
				unrepresentable: 'throw',
			})
			const bytes = Buffer.byteLength(
				JSON.stringify({
					type: 'function',
					name,
					description: record.description ?? '',
					parameters,
				}),
			)
			perToolSchemaBytes[name] = bytes
			allToolsSchemaBytes += bytes
		}

		const parallelResults = (await Promise.all([
			execTool(
				tools.add_notes,
				{ notes: [{ id: 'p-note', x: 80, y: 240, text: 'Parallel evidence' }] },
				'p1',
			),
			execTool(
				tools.add_boxes,
				{ boxes: [{ id: 'p-box', x: 420, y: 240, w: 200, h: 100, text: 'Parallel node' }] },
				'p2',
			),
			execTool(
				tools.add_connectors,
				{ connectors: [{ id: 'p-link', from: 'p-note', to: 'p-box' }] },
				'p3',
			),
			execTool(
				tools.add_frames,
				{ frames: [{ id: 'p-frame', title: 'Parallel lane', memberIds: ['p-note', 'p-box'] }] },
				'p4',
			),
		])) as { ok: boolean }[]
		const parallelChainSucceeded = parallelResults.every((reply) => reply.ok === true)

		const textReply = (await execTool(
			tools.add_texts,
			{ texts: [{ id: 'p-title', x: 80, y: 144, text: 'Geometry Probe', fontSize: 40 }] },
			'p5',
		)) as { ok: boolean; created?: Record<string, unknown>[] }
		const createdEntry = textReply.created?.[0]
		const geometryReceiptPresent = Boolean(
			createdEntry &&
				typeof createdEntry.x === 'number' &&
				typeof createdEntry.y === 'number' &&
				typeof createdEntry.w === 'number' &&
				typeof createdEntry.h === 'number',
		)

		let activeChatTools: unknown[] = []
		let activeLectureTools: unknown[] = []
		const calls: LanguageModelV4CallOptions[] = []
		await withEvalDaemon(
			stopModel((options) => calls.push(options)),
			async (url) => {
				await fetch(`${url}/api/ai/chat`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						mode: 'chat',
						messages: [{ id: 'u-chat', role: 'user', parts: [{ type: 'text', text: 'Draw' }] }],
					}),
				}).then((res) => res.text())
				activeChatTools = calls[0]?.tools ?? []
				const beforeLecture = calls.length
				await fetch(`${url}/api/ai/chat`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						mode: 'lecture',
						messages: [{ id: 'u-lec', role: 'user', parts: [{ type: 'text', text: 'Speech' }] }],
					}),
				}).then((res) => res.text())
				activeLectureTools = calls[beforeLecture]?.tools ?? []
			},
		)

		const renderedCard = htmlCardDocument(
			'<main class="mico-report"><div class="mico-panel">Check</div></main>',
			'',
			'',
		)
		const htmlCardRuntimeCssInjected =
			renderedCard.includes('.mico-report') && renderedCard.includes('.mico-panel')

		return {
			allToolsCount: Object.keys(tools).length,
			allToolsSchemaBytes,
			activeChatNoImageToolCount: activeChatTools.length,
			activeChatNoImageSchemaBytes: Buffer.byteLength(JSON.stringify(activeChatTools)),
			activeLectureNoImageToolCount: activeLectureTools.length,
			activeLectureNoImageSchemaBytes: Buffer.byteLength(JSON.stringify(activeLectureTools)),
			perToolSchemaBytes,
			parallelChainSucceeded,
			geometryReceiptPresent,
			htmlCardRuntimeCssInjected,
		}
	} finally {
		await boardStore.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

function extractSystemText(call: LanguageModelV4CallOptions | undefined): string {
	if (!call) return ''
	const sys = call.prompt.find((msg) => msg.role === 'system')
	if (!sys) return ''
	return typeof sys.content === 'string' ? sys.content : JSON.stringify(sys.content)
}

function syntheticBoard(shapeCount: number): Board {
	const shapes: Shape[] = [
		{
			id: 'meeting-title',
			type: 'text',
			x: 80,
			y: 144,
			w: 420,
			h: 64,
			color: '#2b3038',
			text: 'Q3 Quarterly Product Review',
			fontSize: 48,
		},
		{
			id: 'topic-frame-1',
			type: 'frame',
			x: 40,
			y: 240,
			w: 1400,
			h: 520,
			color: '#00a2e1',
			title: 'Topic 1: Core Growth Metrics',
		},
		{
			id: 'topic-card-1',
			type: 'html',
			x: 1620,
			y: 260,
			w: 960,
			h: 620,
			color: '#00a2e1',
			title: 'Topic 1 Summary',
			html: '<main class="mico-report"><h1>Topic 1</h1></main>',
		},
		{
			id: 'actions-main',
			type: 'actions',
			x: 2720,
			y: 260,
			w: 320,
			h: 220,
			color: '#f1fadc',
			title: 'Actions',
			items: [{ id: 'a-1', text: 'Follow up on landing page', done: false }],
		},
	]
	for (let index = shapes.length; index < shapeCount; index++) {
		const lane = Math.floor(index / 40)
		shapes.push({
			id: `item-${index}`,
			type: index % 2 === 0 ? 'note' : 'rectangle',
			x: 80 + (index % 4) * 320,
			y: 280 + lane * 700 + Math.floor((index % 40) / 4) * 140,
			w: 240,
			h: 110,
			color: index % 2 === 0 ? '#e2f5fc' : '#00a2e1',
			...(index < 40 ? { frameId: 'topic-frame-1' } : {}),
			text: `Fact or node ${index}: detailed metric value ${index * 3}%`,
		})
	}
	return { revision: shapeCount, shapes }
}

async function measureL2BoardAndCache(): Promise<L2BoardAndCacheMetrics> {
	const calls: LanguageModelV4CallOptions[] = []
	await withEvalDaemon(
		stopModel((options) => calls.push(options)),
		async (url, store) => {
			await fetch(`${url}/api/ai/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					mode: 'lecture',
					messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Segment 1' }] }],
				}),
			}).then((res) => res.text())

			await store.applyRequest({
				operations: [
					{
						type: 'create',
						shape: {
							id: 'rev-note-1',
							type: 'note',
							x: 80,
							y: 240,
							w: 260,
							h: 180,
							color: '#e2f5fc',
							text: 'Changed board between turns',
						},
					},
				],
			})

			await fetch(`${url}/api/ai/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					mode: 'lecture',
					messages: [
						{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Segment 1' }] },
						{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Updated note' }] },
						{ id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Segment 2' }] },
					],
				}),
			}).then((res) => res.text())
		},
	)

	const sys1 = extractSystemText(calls[0])
	const sys2 = extractSystemText(calls[1])
	const board50 = syntheticBoard(50)
	const board180 = syntheticBoard(180)
	const ctx50 = aiBoardMod.formatBoardContext(board50, [])
	const ctx180 = aiBoardMod.formatBoardContext(board180, [])
	const anchorsRetainedAt180Shapes = [
		'meeting-title',
		'topic-frame-1',
		'topic-card-1',
		'actions-main',
	].every((id) => ctx180.includes(id))

	const buildStatic = (aiPromptMod as Record<string, unknown>).buildStaticInstructions as
		| ((mode?: 'chat' | 'lecture', options?: { imageGenerationAvailable?: boolean }) => string)
		| undefined

	const staticChatPromptBytes = buildStatic
		? Buffer.byteLength(buildStatic('chat', { imageGenerationAvailable: false }))
		: Buffer.byteLength(aiPromptMod.AI_SYSTEM_PROMPT)
	const staticLecturePromptBytes = buildStatic
		? Buffer.byteLength(buildStatic('lecture', { imageGenerationAvailable: false }))
		: Buffer.byteLength(`${aiPromptMod.AI_SYSTEM_PROMPT}\n\n${aiPromptMod.AI_LECTURE_PROMPT}`)

	return {
		staticChatPromptBytes,
		staticLecturePromptBytes,
		postSessionPromptBytes: Buffer.byteLength(POST_SESSION_SUMMARY_PROMPT),
		systemPromptTurn1Bytes: Buffer.byteLength(sys1),
		systemPromptTurn2Bytes: Buffer.byteLength(sys2),
		systemPromptInvariantAcrossRevisions: sys1.length > 0 && sys1 === sys2,
		boardContext50ShapesBytes: Buffer.byteLength(ctx50),
		boardContext180ShapesBytes: Buffer.byteLength(ctx180),
		anchorsRetainedAt180Shapes,
	}
}

function syntheticConversation(turnCount: number): UIMessage[] {
	const messages: UIMessage[] = []
	const bigBoardOutput = {
		ok: true,
		revision: 12,
		count: 40,
		shapes: Array.from({ length: 30 }, (_, index) => ({
			id: `shape-${index}`,
			type: 'note',
			x: 80 + (index % 4) * 280,
			y: 260 + Math.floor(index / 4) * 200,
			w: 260,
			h: 180,
			text: `Recorded discussion evidence item ${index} with metrics and qualifiers.`,
		})),
	}
	const bigHtml = `<main class="mico-report"><h1>Topic Summary</h1><p>${'Detailed synthesis '.repeat(350)}</p></main>`

	for (let turn = 1; turn <= turnCount; turn++) {
		messages.push({
			id: `u-${turn}`,
			role: 'user',
			parts: [
				{
					type: 'text',
					text: `[Lecture | Live speech · Microphone | segment ${turn} | 10:00–10:06] Discussion segment ${turn} covering milestone updates and owner assignments.`,
				},
			],
		})
		if (turn === turnCount) break
		const parts: UIMessage['parts'] = [
			{
				type: 'tool-add_notes',
				toolCallId: `call-note-${turn}`,
				state: 'output-available',
				input: {
					notes: [{ id: `note-${turn}`, x: 80, y: 240 + turn * 20, text: `Point ${turn}` }],
				},
				output: { ok: true, revision: turn, created: [{ id: `note-${turn}`, type: 'note' }] },
			},
		]
		if (turn % 4 === 0) {
			parts.push({
				type: 'tool-get_board',
				toolCallId: `call-board-${turn}`,
				state: 'output-available',
				input: {},
				output: bigBoardOutput,
			})
		}
		if (turn % 24 === 0) {
			parts.push({
				type: 'tool-add_html_cards',
				toolCallId: `call-card-${turn}`,
				state: 'output-available',
				input: {
					cards: [
						{
							id: `topic-card-${turn}`,
							x: 1620,
							y: 260,
							w: 960,
							h: 680,
							title: `Topic ${turn / 24}`,
							html: bigHtml,
						},
					],
				},
				output: { ok: true, revision: turn, created: [{ id: `topic-card-${turn}`, type: 'html' }] },
			})
		}
		parts.push({ type: 'text', text: `Added segment ${turn}.` })
		messages.push({ id: `a-${turn}`, role: 'assistant', parts })
	}
	return messages
}

function commonPrefixRatio(prevPayload: string, nextPayload: string): number {
	const minLen = Math.min(prevPayload.length, nextPayload.length)
	let shared = 0
	while (shared < minLen && prevPayload.charCodeAt(shared) === nextPayload.charCodeAt(shared)) {
		shared++
	}
	return nextPayload.length > 0 ? Number((shared / nextPayload.length).toFixed(4)) : 0
}

async function measureL3Compaction(): Promise<L3CompactionMetrics> {
	const snapshots = new Map<number, string>()
	const accepted = new Map<number, boolean>()
	const wireBytes = new Map<number, number>()
	const calls: LanguageModelV4CallOptions[] = []

	await withEvalDaemon(
		stopModel((options) => calls.push(options)),
		async (url, store) => {
			const turns = [20, 60, 99, 100, 105, 119, 120]
			for (const turn of turns) {
				if (turn === 100 || turn === 120) {
					await store.applyRequest({
						operations: [
							{
								type: 'create',
								shape: {
									id: `board-bump-${turn}`,
									type: 'note',
									x: 80,
									y: 240 + turn,
									w: 260,
									h: 180,
									color: '#e2f5fc',
									text: `Revision bump at turn ${turn}`,
								},
							},
						],
					})
				}
				const beforeCount = calls.length
				const payload = JSON.stringify({
					mode: 'lecture',
					messages: syntheticConversation(turn),
					selection: [],
				})
				wireBytes.set(turn, Buffer.byteLength(payload))
				const response = await fetch(`${url}/api/ai/chat`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: payload,
				})
				await response.text()
				const ok = response.status === 200 && calls.length > beforeCount
				accepted.set(turn, ok)
				if (ok) {
					const call = calls[calls.length - 1]
					snapshots.set(turn, JSON.stringify({ tools: call.tools, prompt: call.prompt }))
				}
			}
		},
	)

	const bytesOf = (turn: number): number | null => {
		const raw = snapshots.get(turn)
		return raw ? Buffer.byteLength(raw) : null
	}
	const s99 = snapshots.get(99)
	const s100 = snapshots.get(100)
	const s119 = snapshots.get(119)
	const s120 = snapshots.get(120)

	return {
		turn20ModelBytes: bytesOf(20) ?? 0,
		turn60ModelBytes: bytesOf(60) ?? 0,
		turn100ModelBytes: bytesOf(100),
		turn105AcceptedWithoutHttp400: accepted.get(105) === true,
		turn120AcceptedWithoutHttp400: accepted.get(120) === true,
		turn120WireBytes: wireBytes.get(120) ?? 0,
		turn120ModelBytes: bytesOf(120),
		turn100CacheablePrefixRatio: s99 && s100 ? commonPrefixRatio(s99, s100) : 0,
		turn120CacheablePrefixRatio: s119 && s120 ? commonPrefixRatio(s119, s120) : null,
	}
}

function measureL4SttAndQueue(): L4SttAndQueueMetrics {
	const text = readFileSync('evals/cases/c14-quarterly-product-review.zh.txt', 'utf8')
	const sentences = splitSentences(text, 'zh')
	const isLowSignal = (protocolMod as Record<string, unknown>).isLowSignalSegment as
		| ((value: string) => boolean)
		| undefined
	const shouldAutoSummary = (protocolMod as Record<string, unknown>).shouldAutoRequestSummary as
		| ((state: {
				sessionEnded: boolean
				error: boolean
				lastErrorSource: 'lecture' | 'summary' | 'chat' | null
				busy: boolean
				summaryDone: boolean
				summaryRequesting: boolean
				summaryAttempted: boolean
				messagesLength: number
				requestLock: boolean
				queueLength: number
		  }) => boolean)
		| undefined

	const liveMicSilence =
		typeof (micVmMod as Record<string, unknown>).LIVE_MICROPHONE_SILENCE_MS === 'number'
			? ((micVmMod as Record<string, unknown>).LIVE_MICROPHONE_SILENCE_MS as number)
			: new SilenceSegmenter().currentSilenceMs

	const audioDefaultSilence = new SilenceSegmenter().currentSilenceMs

	const arrivalIntervalMs = 5500
	const arrivals = sentences.map((sentence, index) => ({
		atMs: index * arrivalIntervalMs,
		payload: lectureSegmentText(
			{ subject: '季度复盘与规划', title: 'Q3业务复盘与Q4技术规划会' },
			index + 1,
			index * 5.5,
			(index + 1) * 5.5,
			sentence,
		),
		raw: sentence,
	}))

	let coalescedFillerCount = 0
	const queue: { payload: string; atMs: number }[] = []
	let nextIndex = 0
	let nowMs = 0
	let busyUntilMs = 0
	let dispatchedBatchCount = 0
	let maxQueueDepth = 0
	const lags: number[] = []

	while (nextIndex < arrivals.length || queue.length > 0) {
		while (nextIndex < arrivals.length && arrivals[nextIndex].atMs <= nowMs) {
			const candidate = arrivals[nextIndex++]
			if (isLowSignal?.(candidate.raw)) coalescedFillerCount++
			queue.push({ payload: candidate.payload, atMs: candidate.atMs })
		}
		maxQueueDepth = Math.max(maxQueueDepth, queue.length)

		if (nowMs >= busyUntilMs && queue.length > 0) {
			const allArrived = nextIndex >= arrivals.length
			const taken = (
				protocolMod.takeLectureBatch as (
					q: readonly string[],
					maxCount?: number,
					maxChars?: number,
					options?: { flushAll?: boolean },
				) => { batch: string[]; remaining: string[] }
			)(
				queue.map((item) => item.payload),
				undefined,
				undefined,
				{ flushAll: allArrived },
			)
			if (taken.batch.length > 0) {
				const dispatched = queue.splice(0, taken.batch.length)
				dispatchedBatchCount++
				const inLateBurst = dispatchedBatchCount >= 15 && dispatchedBatchCount <= 28
				const serviceMs = inLateBurst || dispatchedBatchCount % 8 === 0 ? 20_000 : 7500
				busyUntilMs = nowMs + serviceMs
				for (const item of dispatched) {
					lags.push(busyUntilMs - item.atMs)
				}
				nowMs = Math.min(
					busyUntilMs,
					nextIndex < arrivals.length ? arrivals[nextIndex].atMs : busyUntilMs,
				)
				continue
			}
		}

		const nextEventMs = Math.min(
			nextIndex < arrivals.length ? arrivals[nextIndex].atMs : Number.POSITIVE_INFINITY,
			busyUntilMs > nowMs ? busyUntilMs : Number.POSITIVE_INFINITY,
		)
		if (!Number.isFinite(nextEventMs)) break
		nowMs = nextEventMs
	}

	const sortedLags = [...lags].sort((a, b) => a - b)
	const p95Index = Math.min(sortedLags.length - 1, Math.floor(sortedLags.length * 0.95))
	const summaryRecoveredAfterLectureError = Boolean(
		shouldAutoSummary?.({
			sessionEnded: true,
			error: true,
			lastErrorSource: 'lecture',
			busy: false,
			summaryDone: false,
			summaryRequesting: false,
			summaryAttempted: false,
			messagesLength: 20,
			requestLock: false,
			queueLength: 0,
		}),
	)

	return {
		c14SegmentCount: sentences.length,
		liveMicDefaultSilenceMs: liveMicSilence,
		audioPlaybackDefaultSilenceMs: audioDefaultSilence,
		coalescedFillerCount,
		dispatchedBatchCount,
		maxQueueDepth,
		p95DrawingLagMs: Math.round(sortedLags[p95Index] ?? 0),
		summaryRecoveredAfterLectureError,
	}
}

function measureL5Prompt(): L5PromptMetrics {
	const lecturePrompt = `${aiPromptMod.AI_SYSTEM_PROMPT}\n\n${aiPromptMod.AI_LECTURE_PROMPT}`
	const summaryPrompt = POST_SESSION_SUMMARY_PROMPT
	return {
		promptAllowsMultipleTopicCards: /topic-card-/i.test(lecturePrompt),
		promptDefinesTopicTransitionTrigger:
			/topic[\s-]+transition|next topic|new topic|议题切换/i.test(lecturePrompt) &&
			/topic-card-/i.test(lecturePrompt),
		promptNoSingletonSummaryLock:
			!/exactly one prominent HTML summary/i.test(lecturePrompt) &&
			!/exactly one prominent HTML summary/i.test(summaryPrompt),
		promptRequiresConditionalExecutiveCard:
			/executive-summary/i.test(summaryPrompt) && /2 or more|>= 2|two or more/i.test(summaryPrompt),
	}
}

export async function runLayeredEval(options: {
	layer: 'all' | EvalLayerId
}): Promise<LayeredEvalReport> {
	const want = (id: EvalLayerId) => options.layer === 'all' || options.layer === id
	const report: LayeredEvalReport = { generatedAt: new Date().toISOString() }
	if (want('L1')) report.L1 = await measureL1Tools()
	if (want('L2')) report.L2 = await measureL2BoardAndCache()
	if (want('L3')) report.L3 = await measureL3Compaction()
	if (want('L4')) report.L4 = measureL4SttAndQueue()
	if (want('L5')) report.L5 = measureL5Prompt()
	return report
}

async function runLiveCaseEval(caseId: string): Promise<void> {
	const suite = loadLayeredEvalSuite()
	const rubric = suite.cases.find((item) => item.id === caseId || item.id.startsWith(`${caseId}-`))
	if (!rubric) {
		throw new Error(
			`Unknown case "${caseId}". Available: ${suite.cases.map((item) => item.id).join(', ')}`,
		)
	}
	const env = loadRuntimeEnv()
	const config = loadAiConfig(env)
	if (!config.chat.baseURL || !config.chat.model) {
		throw new Error('Chat model configuration is missing for --live evaluation')
	}

	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-live-eval-'))
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'ai-settings', 'settings.json'),
		env,
		createAiModel: () => createMagpieModel(config.chat),
	})
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
	const address = daemon.server.address()
	if (!address || typeof address === 'string') throw new Error('Invalid eval daemon port')
	const baseUrl = `http://127.0.0.1:${address.port}`

	try {
		const canvasId = await daemon.store.getActiveCanvasId()
		const text = readFileSync(rubric.file, 'utf8')
		const sentences = splitSentences(text, rubric.lang)
		const chat = new Chat({
			transport: new DefaultChatTransport({ api: `${baseUrl}/api/ai/chat` }),
		})
		const turnLatencies: number[] = []

		for (let index = 0; index < sentences.length; index++) {
			const promptText = lectureSegmentText(
				{ subject: rubric.subject, title: rubric.title },
				index + 1,
				index * 5,
				(index + 1) * 5,
				sentences[index],
			)
			const started = Date.now()
			await chat.sendMessage(
				{ text: promptText },
				{ body: { selection: [], mode: 'lecture', canvasId } },
			)
			turnLatencies.push(Date.now() - started)
		}

		const summaryStart = Date.now()
		await chat.sendMessage(
			{ text: POST_SESSION_SUMMARY_PROMPT },
			{ body: { selection: [], mode: 'chat', canvasId } },
		)
		const summaryMs = Date.now() - summaryStart

		const finalBoard = await daemon.store.getBoard(canvasId)
		const evaluation = evaluateBoardAgainstRubric(finalBoard, rubric)
		const sorted = [...turnLatencies].sort((a, b) => a - b)
		const p50Ms = sorted[Math.floor(sorted.length * 0.5)] ?? 0
		const p95Ms = sorted[Math.floor(sorted.length * 0.95)] ?? 0
		console.log(
			JSON.stringify(
				{
					liveCase: rubric.id,
					model: config.chat.model,
					turns: sentences.length + 1,
					turnLatencyP50Ms: p50Ms,
					turnLatencyP95Ms: p95Ms,
					summaryLatencyMs: summaryMs,
					evaluation,
				},
				null,
				2,
			),
		)
	} finally {
		for (const client of daemon.wss.clients) client.terminate()
		await daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

async function main(): Promise<void> {
	const args = parseEvalCliArgs(process.argv.slice(2))
	if (args.live) {
		if (!args.caseId) {
			throw new Error('Pass --case <id> together with --live')
		}
		await runLiveCaseEval(args.caseId)
		return
	}
	const report = await runLayeredEval({ layer: args.layer })
	if (args.json) {
		console.log(JSON.stringify(report, null, 2))
		return
	}
	console.log('=== Mico Layered AI Pipeline Eval ===')
	console.log(JSON.stringify(report, null, 2))
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
