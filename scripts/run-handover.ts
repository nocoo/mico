import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chat } from '@ai-sdk/react'
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from 'ai'
import { POST_SESSION_SUMMARY_PROMPT } from '../src/shared/summaryPrompt.ts'

const FIXED_TEXT = join('evals', 'cases', 'c11-er-handover.zh.txt')
const RUN_ROOT = join('evals', 'runs')
const DEFAULT_BASE = 'http://127.0.0.1:37063'
const SUBJECT = '急诊护理交接'
const TITLE = '急诊交接'

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface HandoverChat {
	messages: UIMessage[]
	status: string
	error?: Error
	sendMessage(message: { text: string }, options: { body: Record<string, unknown> }): Promise<void>
	stop(): void
}

export function parseRound(value: string | undefined): 1 | 2 {
	if (value !== '1' && value !== '2') {
		throw new Error('Usage: node scripts/run-handover.ts <1|2>')
	}
	return Number(value) as 1 | 2
}

export function compactTimestamp(date: Date): string {
	return date.toISOString().replace(/[-:.]/g, '')
}

export function canvasName(round: 1 | 2, date: Date): string {
	const name = `急诊交接 · 第${round}轮 · ${compactTimestamp(date)}`
	if (name.length > 80) throw new Error('Canvas name exceeds 80 characters')
	return name
}

export function splitZhSentences(text: string): string[] {
	const normal = text.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
	if (!normal) return []
	if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
		throw new Error('Intl.Segmenter zh-CN is unavailable')
	}
	const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'sentence' })
	return [...segmenter.segment(normal)].map((part) => part.segment.trim()).filter(Boolean)
}

export function formatLectureSegmentText(index: number, text: string): string {
	return `[Lecture | ${SUBJECT} · ${TITLE} | segment ${index} | 0:00–0:00] ${text}`
}

export function buildTurnRequest(
	text: string,
	mode: 'lecture' | 'chat',
	canvasId: string,
): { text: string; body: { selection: string[]; mode: 'lecture' | 'chat'; canvasId: string } } {
	return { text, body: { selection: [], mode, canvasId } }
}

export function createUniqueRunDirectory(round: 1 | 2, date: Date): string {
	mkdirSync(RUN_ROOT, { recursive: true })
	return mkdtempSync(join(RUN_ROOT, `handover-r${round}-${compactTimestamp(date)}-`))
}

async function api(
	fetchImpl: FetchLike,
	base: string,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	const response = await fetchImpl(`${base}${path}`, {
		...init,
		headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
		signal: AbortSignal.timeout(20_000),
	})
	if (!response.ok) {
		throw new Error(`${path} -> ${response.status}`)
	}
	return response
}

export async function createHandoverCanvas(
	fetchImpl: FetchLike,
	base: string,
	name: string,
): Promise<string> {
	const created = (await (
		await api(fetchImpl, base, '/api/canvases', {
			method: 'POST',
			body: JSON.stringify({ name, activate: true }),
		})
	).json()) as { createdCanvasId?: unknown }
	if (typeof created.createdCanvasId !== 'string' || created.createdCanvasId.length === 0) {
		throw new Error('Canvas creation response did not contain a verified id')
	}
	const canvasId = created.createdCanvasId
	const detail = (await (
		await api(fetchImpl, base, `/api/canvases/${encodeURIComponent(canvasId)}`)
	).json()) as { canvas?: { id?: unknown }; board?: { revision?: unknown; shapes?: unknown } }
	if (detail.canvas?.id !== canvasId) {
		throw new Error('Created canvas id verification failed')
	}
	if (
		detail.board?.revision !== 0 ||
		!Array.isArray(detail.board.shapes) ||
		detail.board.shapes.length !== 0
	) {
		throw new Error('Created canvas is not empty')
	}
	return canvasId
}

interface ToolLog {
	name: string
	state: string
	input: unknown
	output: unknown
	error?: string
	failed: boolean
}

function inspectAssistant(
	chat: HandoverChat,
	beforeIds: Set<string>,
): { text: string; tools: ToolLog[]; assistantMessages: unknown[] } {
	const messages = chat.messages.filter((message) => !beforeIds.has(message.id))
	const assistants = messages.filter((message) => message.role === 'assistant')
	let text = ''
	const tools: ToolLog[] = []
	for (const message of assistants) {
		for (const part of message.parts) {
			if (part.type === 'text') text += part.text
			if (!isToolUIPart(part)) continue
			const output = part.output as { ok?: boolean; error?: string } | undefined
			tools.push({
				name: getToolName(part),
				state: part.state,
				input: part.input,
				output: part.output,
				error: (part as { errorText?: string }).errorText,
				failed:
					part.state === 'output-error' ||
					(part.state === 'output-available' && output?.ok === false),
			})
		}
	}
	return { text: text.trim(), tools, assistantMessages: assistants }
}

function collectRevisions(value: unknown): number[] {
	const found: number[] = []
	const seen = new WeakSet<object>()
	const visit = (item: unknown): void => {
		if (!item || typeof item !== 'object' || seen.has(item)) return
		seen.add(item)
		if (Array.isArray(item)) {
			for (const child of item) visit(child)
			return
		}
		for (const [key, child] of Object.entries(item)) {
			if (key === 'revision' && typeof child === 'number') found.push(child)
			visit(child)
		}
	}
	visit(value)
	return [...new Set(found)].sort((a, b) => a - b)
}

async function getBoard(fetchImpl: FetchLike, base: string, canvasId: string): Promise<unknown> {
	return (await (
		await api(fetchImpl, base, `/api/canvases/${encodeURIComponent(canvasId)}`)
	).json()) as unknown
}

function boardRevision(detail: unknown): number | undefined {
	if (!detail || typeof detail !== 'object') return undefined
	const board = (detail as { board?: { revision?: unknown } }).board
	return typeof board?.revision === 'number' ? board.revision : undefined
}

function appendJsonl(directory: string, record: unknown): void {
	writeFileSync(join(directory, 'transcript.jsonl'), `${JSON.stringify(record)}\n`, {
		flag: 'a',
	})
}

interface RunState {
	round: 1 | 2
	startedAt: string
	canvasId?: string
	canvasName: string
	fixedText: string
	segments: number
	summaryRequested: boolean
	turns: number
	status: 'running' | 'success' | 'error'
	error?: string
	finalBoardRevision?: number
}

async function sendOneTurn(options: {
	chat: HandoverChat
	fetchImpl: FetchLike
	base: string
	canvasId: string
	text: string
	mode: 'lecture' | 'chat'
	timeoutMs: number
	directory: string
	index: number
}): Promise<unknown> {
	const { chat, fetchImpl, base, canvasId, text, mode, timeoutMs, directory, index } = options
	const exactRequest = buildTurnRequest(text, mode, canvasId)
	const beforeIds = new Set(chat.messages.map((message) => message.id))
	const conversationBefore = chat.messages.map((message) => message)
	const beforeDetail = await getBoard(fetchImpl, base, canvasId)
	const startedAt = new Date().toISOString()
	const started = Date.now()
	let timedOut = false
	let chatError: string | undefined
	const timer = setTimeout(() => {
		timedOut = true
		chat.stop()
	}, timeoutMs)
	try {
		await chat.sendMessage({ text }, { body: exactRequest.body })
		if (chat.error) chatError = chat.error.message
	} catch (error) {
		chatError = (error as Error).message
	} finally {
		clearTimeout(timer)
	}
	const elapsedMs = Date.now() - started
	const inspected = inspectAssistant(chat, beforeIds)
	const afterDetail = await getBoard(fetchImpl, base, canvasId)
	const beforeRevision = boardRevision(beforeDetail)
	const afterRevision = boardRevision(afterDetail)
	const toolRevisions = collectRevisions(inspected.tools.map((tool) => tool.output))
	const emptyOutput = inspected.text.length === 0 && inspected.tools.length === 0
	const record = {
		index,
		startedAt,
		endedAt: new Date().toISOString(),
		elapsedMs,
		timedOut,
		exactInput: {
			text,
			body: exactRequest.body,
			conversationBefore,
		},
		output: {
			text: inspected.text,
			assistantMessages: inspected.assistantMessages,
		},
		tools: inspected.tools,
		chatError,
		status: String(chat.status),
		revisions: {
			before: beforeRevision,
			after: afterRevision,
			tool: toolRevisions,
		},
	}
	appendJsonl(directory, record)
	if (timedOut) throw new Error(`Turn ${index} timed out`)
	if (chatError) throw new Error(`Turn ${index} stream error: ${chatError}`)
	if (emptyOutput) throw new Error(`Turn ${index} completed with empty output`)
	console.log(
		`Turn ${index}: ${inspected.tools.map((item) => `${item.name}${item.failed ? ' (failed)' : ''}`).join(', ') || 'no tools'} (${elapsedMs} ms)`,
	)
	return record
}

async function main(): Promise<void> {
	const round = parseRound(process.argv[2])
	if (process.argv[3] !== '--confirm-live-canvas') {
		throw new Error(
			'Pass --confirm-live-canvas to create a new canvas and send the fixed transcript',
		)
	}
	if (!existsSync(FIXED_TEXT)) throw new Error(`Fixed text file missing: ${FIXED_TEXT}`)
	const text = readFileSync(FIXED_TEXT, 'utf8')
	const segments = splitZhSentences(text)
	if (segments.length === 0) throw new Error('Fixed text contains no Chinese sentences')

	const base = process.env.MICO_API?.trim() || DEFAULT_BASE
	const fetchImpl = fetch
	const now = new Date()
	const directory = createUniqueRunDirectory(round, now)
	const name = canvasName(round, now)
	const state: RunState = {
		round,
		startedAt: now.toISOString(),
		canvasName: name,
		fixedText: FIXED_TEXT,
		segments: segments.length,
		summaryRequested: false,
		turns: 0,
		status: 'running',
	}
	let canvasId: string | undefined
	try {
		canvasId = await createHandoverCanvas(fetchImpl, base, name)
		state.canvasId = canvasId
		writeFileSync(join(directory, 'run.json'), `${JSON.stringify(state, null, 2)}\n`)

		const chat = new Chat({
			transport: new DefaultChatTransport({ api: `${base}/api/ai/chat` }),
		}) as unknown as HandoverChat
		for (let index = 0; index < segments.length; index++) {
			await sendOneTurn({
				chat,
				fetchImpl,
				base,
				canvasId,
				text: formatLectureSegmentText(index + 1, segments[index]),
				mode: 'lecture',
				timeoutMs: Number(process.env.SEGMENT_TIMEOUT_MS ?? 120_000),
				directory,
				index: index + 1,
			})
			state.turns = index + 1
			writeFileSync(join(directory, 'run.json'), `${JSON.stringify(state, null, 2)}\n`)
		}

		state.summaryRequested = true
		writeFileSync(join(directory, 'run.json'), `${JSON.stringify(state, null, 2)}\n`)
		await sendOneTurn({
			chat,
			fetchImpl,
			base,
			canvasId,
			text: POST_SESSION_SUMMARY_PROMPT,
			mode: 'chat',
			timeoutMs: Number(process.env.SUMMARY_TIMEOUT_MS ?? 180_000),
			directory,
			index: segments.length + 1,
		})
		state.turns = segments.length + 1

		const finalDetail = await getBoard(fetchImpl, base, canvasId)
		writeFileSync(join(directory, 'final-board.json'), `${JSON.stringify(finalDetail, null, 2)}\n`)
		state.finalBoardRevision = boardRevision(finalDetail)
		state.status = 'success'
	} catch (error) {
		state.status = 'error'
		state.error = (error as Error).message
		if (canvasId) {
			try {
				const finalDetail = await getBoard(fetchImpl, base, canvasId)
				writeFileSync(
					join(directory, 'final-board.json'),
					`${JSON.stringify(finalDetail, null, 2)}\n`,
				)
				state.finalBoardRevision = boardRevision(finalDetail)
			} catch (boardError) {
				state.error = `${state.error}; final board read failed: ${(boardError as Error).message}`
			}
		}
	} finally {
		writeFileSync(join(directory, 'run.json'), `${JSON.stringify(state, null, 2)}\n`)
	}

	console.log(
		JSON.stringify({
			runDirectory: directory,
			canvasName: name,
			canvasId,
			round,
			status: state.status,
			error: state.error,
		}),
	)
	if (state.status !== 'success') process.exitCode = 1
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		console.error((error as Error).message)
		process.exitCode = 1
	})
}
