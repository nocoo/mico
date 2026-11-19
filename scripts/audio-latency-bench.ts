import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chat } from '@ai-sdk/react'
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from 'ai'
import { loadAiConfig, loadRuntimeEnv } from '../src/server/aiConfig.ts'
import { createDaemon } from '../src/server/index.ts'
import { compactUiMessages } from '../src/shared/conversationCompact.ts'
import { POST_SESSION_SUMMARY_PROMPT } from '../src/shared/summaryPrompt.ts'
import type { Board, CanvasShape } from '../src/shared/types.ts'
import { isLowSignalSegment, takeLectureBatch } from '../src/web/frame/assistant/protocol.ts'
import { lectureSegmentText } from '../src/web/stt/transcript.ts'
import {
	type BoardRubricEvaluation,
	type CaseRubric,
	evaluateBoardAgainstRubric,
	loadLayeredEvalSuite,
} from './ai-pipeline-eval.ts'

interface BenchArgs {
	confirmProviderUsage: boolean
	caseId: string
	model?: string
	summaryModel?: string
	lectureReasoning?: string
	summaryReasoning?: string
	hotMin?: number
	chunkSize?: number
	coalesceFillers: boolean
	outPath?: string
}

interface ManifestCase {
	id: string
	lang: 'zh' | 'en' | 'ja'
	subject: string
	title: string
	script: string
	duration: number
}

interface TimedSegment {
	id: number
	text: string
	start: number
	end: number
}

interface TurnMeasurement {
	turn: number
	kind: 'lecture' | 'summary'
	elapsedMs: number
	steps: number
	toolCalls: number
	toolErrors: number
	waited: boolean
	queueDepthAtDispatch: number
	batchCount: number
	virtualClockBeforeSec: number
	virtualClockAfterSec: number
	error?: string
}

export interface AudioBenchReport {
	generatedAt: string
	caseId: string
	audioDurationSec: number
	totalRawSegments: number
	coalescedFillers: number
	config: {
		model: string
		summaryModel: string
		lectureReasoning: string
		summaryReasoning: string
		hotMin: number
		chunkSize: number
		coalesceFillers: boolean
	}
	latency: {
		catchUpAfterEndMs: number
		inFlightSpillMs: number
		postEndDrainMs: number
		summaryMs: number
		lectureTurns: number
		avgLectureTurnMs: number
		p95LectureTurnMs: number
		maxLectureTurnMs: number
		avgStepsPerTurn: number
		summarySteps: number
		summaryToolCalls: number
		maxQueueDepth: number
		trailingBacklogTurns: number
	}
	board: {
		shapeCount: number
		topicCardCount: number
		hasExecutiveSummary: boolean
		actionCardCount: number
		actionItemCount: number
		stageCardsAtCol3Ratio: number | null
		col4Aligned: boolean
		waitTurns: number
		toolErrors: number
	}
	rubric: BoardRubricEvaluation | null
	turns: TurnMeasurement[]
}

function parseBool(value: string, flag: string): boolean {
	if (value === 'true') return true
	if (value === 'false') return false
	throw new Error(`${flag} must be true or false`)
}

function parsePositiveInt(value: string, flag: string): number {
	const parsed = Number(value)
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${flag} must be a positive integer`)
	}
	return parsed
}

export function parseBenchArgs(argv: readonly string[]): BenchArgs {
	let confirmProviderUsage = false
	let caseId = 'c15-architecture-tradeoffs'
	let model: string | undefined
	let summaryModel: string | undefined
	let lectureReasoning: string | undefined
	let summaryReasoning: string | undefined
	let hotMin: number | undefined
	let chunkSize: number | undefined
	let coalesceFillers = true
	let outPath: string | undefined

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		const nextValue = () => {
			const val = argv[++index]
			if (!val) throw new Error(`${arg} requires a value`)
			return val
		}
		if (arg === '--confirm-provider-usage') {
			confirmProviderUsage = true
		} else if (arg === '--case') {
			caseId = nextValue()
		} else if (arg === '--model') {
			model = nextValue()
		} else if (arg === '--summary-model') {
			summaryModel = nextValue()
		} else if (arg === '--lecture-reasoning') {
			lectureReasoning = nextValue()
		} else if (arg === '--summary-reasoning') {
			summaryReasoning = nextValue()
		} else if (arg === '--hot-min') {
			hotMin = parsePositiveInt(nextValue(), '--hot-min')
		} else if (arg === '--chunk-size') {
			chunkSize = parsePositiveInt(nextValue(), '--chunk-size')
		} else if (arg === '--coalesce-fillers') {
			coalesceFillers = parseBool(nextValue(), '--coalesce-fillers')
		} else if (arg === '--out') {
			outPath = nextValue()
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	if (!confirmProviderUsage) {
		throw new Error('Pass --confirm-provider-usage before calling an AI gateway')
	}

	return {
		confirmProviderUsage,
		caseId,
		model,
		summaryModel,
		lectureReasoning,
		summaryReasoning,
		hotMin,
		chunkSize,
		coalesceFillers,
		outPath,
	}
}

function loadCaseInput(caseId: string): {
	id: string
	lang: 'zh' | 'en' | 'ja'
	subject: string
	title: string
	file: string
	durationSec?: number
	rubric: CaseRubric | null
} {
	const suite = loadLayeredEvalSuite()
	const rubric =
		suite.cases.find((item) => item.id === caseId || item.id.startsWith(`${caseId}-`)) ?? null
	const manifest = JSON.parse(readFileSync('public/evals/manifest.json', 'utf8')) as {
		evals: ManifestCase[]
	}
	const manifestMatch = manifest.evals.find(
		(item) => item.id === caseId || item.id.startsWith(`${caseId}-`),
	)
	if (rubric) {
		return {
			id: rubric.id,
			lang: rubric.lang,
			subject: rubric.subject,
			title: rubric.title,
			file: rubric.file,
			durationSec: manifestMatch?.duration,
			rubric,
		}
	}
	if (manifestMatch) {
		return {
			id: manifestMatch.id,
			lang: manifestMatch.lang,
			subject: manifestMatch.subject,
			title: manifestMatch.title,
			file: manifestMatch.script,
			durationSec: manifestMatch.duration,
			rubric: null,
		}
	}
	throw new Error(`Unknown benchmark case "${caseId}"`)
}

function buildTimedSegments(
	text: string,
	lang: 'zh' | 'en' | 'ja',
	durationSec?: number,
): TimedSegment[] {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
	const parts =
		lines.length >= 10
			? lines
			: (() => {
					const normal = text.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
					if (!normal) return []
					const locale = lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja-JP' : 'en-US'
					const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })
					return [...segmenter.segment(normal)].map((part) => part.segment.trim()).filter(Boolean)
				})()

	const charsPerSec = lang === 'zh' ? 3.5 : lang === 'ja' ? 6.0 : 14.5
	if (durationSec && durationSec > 0) {
		const weights = parts.map((part) => Math.max(8, part.length))
		const totalWeight = weights.reduce((sum, w) => sum + w, 0)
		let cursor = 0
		return parts.map((segmentText, index) => {
			const span = (weights[index] / Math.max(1, totalWeight)) * durationSec
			const start = cursor
			cursor += span
			return { id: index + 1, text: segmentText, start, end: cursor }
		})
	}

	let cursor = 0
	return parts.map((segmentText, index) => {
		const span = Math.max(2.6, Math.min(9.5, segmentText.length / charsPerSec + 1.1))
		const start = cursor
		cursor += span
		return { id: index + 1, text: segmentText, start, end: cursor }
	})
}

function inspectNewAssistantMessages(messages: UIMessage[], beforeIds: Set<string>) {
	const added = messages.filter((msg) => !beforeIds.has(msg.id) && msg.role === 'assistant')
	let steps = 0
	let toolCalls = 0
	let toolErrors = 0
	let textReply = ''
	for (const msg of added) {
		for (const part of msg.parts) {
			if (part.type === 'step-start') steps++
			if (part.type === 'text') textReply += part.text
			if (isToolUIPart(part)) {
				toolCalls++
				const name = getToolName(part)
				void name
				const output = part.output as { ok?: boolean } | undefined
				if (part.state === 'output-error' || output?.ok === false) {
					toolErrors++
				}
			}
		}
	}
	if (steps === 0 && (toolCalls > 0 || textReply.length > 0)) steps = 1
	const waited = toolCalls === 0 && /^wait[.!。]?$/i.test(textReply.trim())
	return { steps, toolCalls, toolErrors, waited }
}

function evaluateLayoutGeometry(board: Board) {
	const htmlCards = board.shapes.filter((shape): shape is CanvasShape => shape.type === 'html')
	const execCards = htmlCards.filter(
		(card) =>
			/^executive[-_]/i.test(card.id) ||
			/executive overview|总览|全局总览|会议总览/i.test(card.title ?? ''),
	)
	const stageCards = htmlCards.filter((card) => !execCards.includes(card))
	const actionCards = board.shapes.filter((shape): shape is CanvasShape => shape.type === 'actions')
	const actionItemCount = actionCards.reduce((sum, card) => sum + (card.items?.length ?? 0), 0)

	const stageCardsAtCol3Ratio =
		stageCards.length > 0
			? Number(
					(
						stageCards.filter((card) => Math.abs(card.x - 2040) <= 64).length / stageCards.length
					).toFixed(3),
				)
			: null
	const execOk = execCards.length <= 1 && execCards.every((card) => Math.abs(card.x - 3160) <= 64)
	const actionOk =
		actionCards.length <= 1 && actionCards.every((card) => Math.abs(card.x - 3160) <= 64)
	const col4Aligned = (execCards.length > 0 || actionCards.length > 0) && execOk && actionOk

	return {
		shapeCount: board.shapes.length,
		topicCardCount: stageCards.length,
		hasExecutiveSummary: execCards.length === 1,
		actionCardCount: actionCards.length,
		actionItemCount,
		stageCardsAtCol3Ratio,
		col4Aligned,
	}
}

async function runBenchmark(args: BenchArgs): Promise<AudioBenchReport> {
	const caseInput = loadCaseInput(args.caseId)
	const transcript = readFileSync(caseInput.file, 'utf8')
	const timedSegments = buildTimedSegments(transcript, caseInput.lang, caseInput.durationSec)
	const audioDurationSec = timedSegments.at(-1)?.end ?? 0

	const env = { ...loadRuntimeEnv() }
	if (args.model) env.MAGPIE_MODEL = args.model
	if (args.summaryModel) env.MAGPIE_SUMMARY_MODEL = args.summaryModel
	if (args.lectureReasoning) env.MAGPIE_LECTURE_REASONING = args.lectureReasoning
	if (args.summaryReasoning) env.MAGPIE_SUMMARY_REASONING = args.summaryReasoning
	if (args.hotMin !== undefined) env.MICO_LECTURE_HOT_MIN = String(args.hotMin)
	if (args.chunkSize !== undefined) env.MICO_LECTURE_CHUNK_SIZE = String(args.chunkSize)

	const effectiveConfig = loadAiConfig(env)
	const hotMin = args.hotMin ?? 12
	const chunkSize = args.chunkSize ?? 16

	const directory = mkdtempSync(join(tmpdir(), 'mico-audio-bench-'))
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'ai-settings', 'settings.json'),
		env,
	})
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
	const address = daemon.server.address()
	if (!address || typeof address === 'string') throw new Error('Invalid benchmark daemon port')
	const baseUrl = `http://127.0.0.1:${address.port}`

	try {
		const canvasId = await daemon.store.getActiveCanvasId()
		const chat = new Chat({
			transport: new DefaultChatTransport({
				api: `${baseUrl}/api/ai/chat`,
				fetch: (input, init) =>
					fetch(input, {
						...init,
						signal: init?.signal
							? AbortSignal.any([init.signal, AbortSignal.timeout(90_000)])
							: AbortSignal.timeout(90_000),
					}),
				prepareSendMessagesRequest: ({ id, messages, trigger, messageId, body }) => ({
					body: {
						...body,
						id,
						messages: compactUiMessages(messages, { hotMin, chunkSize }),
						trigger,
						messageId,
					},
				}),
			}),
		})

		let clock = 0
		let nextIndex = 0
		let coalescedFillers = 0
		let maxQueueDepth = 0
		let inFlightSpillMs = 0
		let postEndDrainMs = 0
		let trailingBacklogTurns = 0
		let bufferedFiller: { text: string; start: number; end: number; id: number } | null = null
		const queue: string[] = []
		const turns: TurnMeasurement[] = []

		const enqueueReady = (upToSec: number) => {
			while (nextIndex < timedSegments.length && timedSegments[nextIndex].end <= upToSec + 1e-6) {
				const segment = timedSegments[nextIndex++]
				const hasMoreAfter = nextIndex < timedSegments.length
				if (args.coalesceFillers && hasMoreAfter && isLowSignalSegment(segment.text)) {
					coalescedFillers++
					bufferedFiller = bufferedFiller
						? {
								id: segment.id,
								start: bufferedFiller.start,
								end: segment.end,
								text: `${bufferedFiller.text} ${segment.text}`.trim(),
							}
						: segment
					continue
				}
				const mergedText = bufferedFiller
					? `${bufferedFiller.text} ${segment.text}`.trim()
					: segment.text
				const mergedStart = bufferedFiller ? bufferedFiller.start : segment.start
				bufferedFiller = null
				queue.push(
					lectureSegmentText(
						{ subject: caseInput.subject, title: caseInput.title },
						segment.id,
						mergedStart,
						segment.end,
						mergedText,
					),
				)
			}
			if (queue.length > maxQueueDepth) maxQueueDepth = queue.length
		}

		while (nextIndex < timedSegments.length || queue.length > 0 || bufferedFiller !== null) {
			if (queue.length === 0) {
				if (nextIndex < timedSegments.length) {
					clock = Math.max(clock, timedSegments[nextIndex].end)
					enqueueReady(clock)
				}
				if (queue.length === 0 && bufferedFiller !== null) {
					const trailing = bufferedFiller as TimedSegment
					queue.push(
						lectureSegmentText(
							{ subject: caseInput.subject, title: caseInput.title },
							trailing.id,
							trailing.start,
							trailing.end,
							trailing.text,
						),
					)
					bufferedFiller = null
				}
			}
			if (queue.length === 0) continue

			const flushAll = clock >= audioDurationSec
			const queueDepthAtDispatch = queue.length
			const taken = takeLectureBatch(queue, undefined, undefined, { flushAll })
			queue.splice(0, queue.length, ...taken.remaining)

			const beforeClock = clock
			const beforeIds = new Set(chat.messages.map((message) => message.id))
			const started = performance.now()
			await chat.sendMessage(
				{ text: taken.batch.join('\n\n') },
				{ body: { selection: [], mode: 'lecture', canvasId } },
			)
			const elapsedMs = Math.round(performance.now() - started)
			const inspected = inspectNewAssistantMessages(chat.messages, beforeIds)
			clock += elapsedMs / 1000
			if (beforeClock < audioDurationSec && clock >= audioDurationSec) {
				inFlightSpillMs = Math.round((clock - audioDurationSec) * 1000)
			} else if (beforeClock >= audioDurationSec) {
				postEndDrainMs += elapsedMs
				trailingBacklogTurns++
			}
			enqueueReady(clock)
			if (queueDepthAtDispatch > maxQueueDepth) maxQueueDepth = queueDepthAtDispatch
			turns.push({
				turn: turns.length + 1,
				kind: 'lecture',
				elapsedMs,
				steps: inspected.steps,
				toolCalls: inspected.toolCalls,
				toolErrors: inspected.toolErrors,
				waited: inspected.waited,
				queueDepthAtDispatch,
				batchCount: taken.batch.length,
				virtualClockBeforeSec: Number(beforeClock.toFixed(1)),
				virtualClockAfterSec: Number(clock.toFixed(1)),
				...(chat.error ? { error: chat.error.message } : {}),
			})
		}

		const summaryBeforeIds = new Set(chat.messages.map((message) => message.id))
		const summaryStart = performance.now()
		await chat.sendMessage(
			{ text: POST_SESSION_SUMMARY_PROMPT },
			{ body: { selection: [], mode: 'chat', canvasId } },
		)
		const summaryMs = Math.round(performance.now() - summaryStart)
		const summaryInspected = inspectNewAssistantMessages(chat.messages, summaryBeforeIds)
		turns.push({
			turn: turns.length + 1,
			kind: 'summary',
			elapsedMs: summaryMs,
			steps: summaryInspected.steps,
			toolCalls: summaryInspected.toolCalls,
			toolErrors: summaryInspected.toolErrors,
			waited: false,
			queueDepthAtDispatch: 0,
			batchCount: 0,
			virtualClockBeforeSec: Number(clock.toFixed(1)),
			virtualClockAfterSec: Number((clock + summaryMs / 1000).toFixed(1)),
			...(chat.error ? { error: chat.error.message } : {}),
		})

		const finalBoard = await daemon.store.getBoard(canvasId)
		const rubric = caseInput.rubric
			? evaluateBoardAgainstRubric(finalBoard, caseInput.rubric)
			: null
		const layout = evaluateLayoutGeometry(finalBoard)

		const lectureTurns = turns.filter((item) => item.kind === 'lecture')
		const sortedMs = lectureTurns.map((item) => item.elapsedMs).sort((a, b) => a - b)
		const avgLectureTurnMs =
			lectureTurns.length > 0
				? Math.round(
						lectureTurns.reduce((sum, item) => sum + item.elapsedMs, 0) / lectureTurns.length,
					)
				: 0
		const p95LectureTurnMs =
			sortedMs[Math.min(sortedMs.length - 1, Math.floor(sortedMs.length * 0.95))] ?? 0
		const maxLectureTurnMs = sortedMs.at(-1) ?? 0
		const avgStepsPerTurn =
			lectureTurns.length > 0
				? Number(
						(lectureTurns.reduce((sum, item) => sum + item.steps, 0) / lectureTurns.length).toFixed(
							2,
						),
					)
				: 0

		const catchUpAfterEndMs = Math.round(inFlightSpillMs + postEndDrainMs + summaryMs)
		const report: AudioBenchReport = {
			generatedAt: new Date().toISOString(),
			caseId: caseInput.id,
			audioDurationSec: Number(audioDurationSec.toFixed(1)),
			totalRawSegments: timedSegments.length,
			coalescedFillers,
			config: {
				model: effectiveConfig.chat.model,
				summaryModel: args.summaryModel ?? effectiveConfig.chat.model,
				lectureReasoning: effectiveConfig.lectureReasoning,
				summaryReasoning: args.summaryReasoning ?? effectiveConfig.lectureReasoning,
				hotMin,
				chunkSize,
				coalesceFillers: args.coalesceFillers,
			},
			latency: {
				catchUpAfterEndMs,
				inFlightSpillMs,
				postEndDrainMs,
				summaryMs,
				lectureTurns: lectureTurns.length,
				avgLectureTurnMs,
				p95LectureTurnMs,
				maxLectureTurnMs,
				avgStepsPerTurn,
				summarySteps: summaryInspected.steps,
				summaryToolCalls: summaryInspected.toolCalls,
				maxQueueDepth,
				trailingBacklogTurns,
			},
			board: {
				...layout,
				waitTurns: lectureTurns.filter((item) => item.waited).length,
				toolErrors: turns.reduce((sum, item) => sum + item.toolErrors, 0),
			},
			rubric,
			turns,
		}

		if (args.outPath) {
			mkdirSync(dirname(args.outPath), { recursive: true })
			writeFileSync(args.outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
		}
		return report
	} finally {
		for (const client of daemon.wss.clients) client.terminate()
		await daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

async function main(): Promise<void> {
	const args = parseBenchArgs(process.argv.slice(2))
	const report = await runBenchmark(args)
	console.log(
		JSON.stringify(
			{
				caseId: report.caseId,
				config: report.config,
				audioDurationSec: report.audioDurationSec,
				latency: report.latency,
				board: report.board,
				rubric: report.rubric
					? {
							passed: report.rubric.passed,
							topicCards: report.rubric.topicCards,
							duplicateTopicCards: report.rubric.duplicateTopicCards,
							executiveCardMatch: report.rubric.executiveCardMatch,
							actionItems: report.rubric.actionItems,
							keyFactMatchRatio: report.rubric.keyFactMatchRatio,
							overlapPairs: report.rubric.overlapPairs,
							reasons: report.rubric.reasons,
						}
					: null,
			},
			null,
			2,
		),
	)
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
