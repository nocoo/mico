import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Chat } from '@ai-sdk/react'
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from 'ai'
import { POST_SESSION_SUMMARY_PROMPT } from '../src/shared/summaryPrompt.ts'

const BASE = process.env.MICO_API ?? 'http://127.0.0.1:37063'
const ROUND = Number(process.argv[2] ?? 1)
const ONLY = process.argv[3]?.split(',').filter(Boolean)
const OUT = join('evals', 'runs', `round${ROUND}`)
const SEGMENT_TIMEOUT_MS = Number(process.env.SEGMENT_TIMEOUT_MS ?? 120_000)
const SUMMARY_TIMEOUT_MS = Number(process.env.SUMMARY_TIMEOUT_MS ?? 180_000)
const CASE_LIMIT_MS = Number(process.env.CASE_LIMIT_MS ?? 12 * 60_000)
const ROUND_LIMIT_MS = Number(process.env.ROUND_LIMIT_MS ?? 165 * 60_000)
const TARGET_CHARS = { zh: 180, ja: 180, en: 420 } as const

interface CaseEntry {
	id: string
	lang: 'zh' | 'en' | 'ja'
	subject: string
	title: string
	script: string
	audio: string
	duration: number
}

interface ToolLog {
	name: string
	state: string
	input: string
	output: string
	error?: string
	failed: boolean
}

interface SegmentLog {
	index: number
	start: number
	end: number
	text: string
	elapsedMs: number
	timedOut: boolean
	error?: string
	textReply: string
	waits: boolean
	tools: ToolLog[]
	status: string
}

interface CaseLog {
	round: number
	case: CaseEntry
	canvasId: string
	canvasName: string
	startedAt: string
	segments: SegmentLog[]
	summary?: SegmentLog
	finalBoard?: unknown
	stats: Record<string, unknown>
	error?: string
}

function timestamp(): string {
	return new Date().toISOString().slice(11, 19)
}

function log(...args: unknown[]): void {
	console.log(timestamp(), ...args)
}

async function api(path: string, init?: RequestInit): Promise<Response> {
	const response = await fetch(`${BASE}${path}`, {
		...init,
		headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
		signal: AbortSignal.timeout(20_000),
	})
	if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`)
	return response
}

function sentenceUnits(text: string, lang: string): string[] {
	const normal = text.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
	const locale = lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja-JP' : 'en-US'
	const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })
	return [...segmenter.segment(normal)].map((part) => part.segment.trim()).filter(Boolean)
}

function splitLong(sentence: string, target: number): string[] {
	if (sentence.length <= target * 1.8) return [sentence]
	const parts: string[] = []
	let rest = sentence
	while (rest.length > target * 1.8) {
		const window = rest.slice(0, target * 1.4)
		const cut = Math.max(
			window.lastIndexOf('，'),
			window.lastIndexOf('、'),
			window.lastIndexOf(','),
			window.lastIndexOf('；'),
			window.lastIndexOf(';'),
		)
		const at = cut > target * 0.5 ? cut + 1 : target
		parts.push(rest.slice(0, at).trim())
		rest = rest.slice(at).trim()
	}
	if (rest) parts.push(rest)
	return parts
}

function buildSegments(caseEntry: CaseEntry): { text: string; start: number; end: number }[] {
	const target = TARGET_CHARS[caseEntry.lang]
	const units = sentenceUnits(
		readFileSync(join('evals', 'cases', caseEntry.script), 'utf8'),
		caseEntry.lang,
	).flatMap((sentence) => splitLong(sentence, target))
	const groups: string[] = []
	let current = ''
	for (const unit of units) {
		if (current && current.length + unit.length + 1 > target) {
			groups.push(current)
			current = unit
		} else {
			current = current ? `${current} ${unit}` : unit
		}
	}
	if (current) groups.push(current)
	const totalChars = groups.reduce((sum, group) => sum + group.length, 0)
	let cursor = 0
	return groups.map((text) => {
		const start = (cursor / totalChars) * caseEntry.duration
		cursor += text.length
		const end = (cursor / totalChars) * caseEntry.duration
		return { text, start, end }
	})
}

function summarizeValue(value: unknown, limit = 600): string {
	if (value === undefined) return ''
	try {
		const text = JSON.stringify(value)
		return text.length > limit ? `${text.slice(0, limit)}…` : text
	} catch {
		return String(value).slice(0, limit)
	}
}

function inspectAssistant(
	chat: Chat<UIMessage>,
	beforeIds: Set<string>,
): {
	text: string
	tools: ToolLog[]
} {
	const messages = (chat.messages as UIMessage[]).filter((message) => !beforeIds.has(message.id))
	const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
	if (!lastAssistant) return { text: '', tools: [] }
	let text = ''
	const tools: ToolLog[] = []
	for (const part of lastAssistant.parts) {
		if (part.type === 'text') text += part.text
		if (!isToolUIPart(part)) continue
		const output = part.output as { ok?: boolean; message?: string; error?: string } | undefined
		tools.push({
			name: getToolName(part),
			state: part.state,
			input: summarizeValue(part.input, 900),
			output: summarizeValue(part.output, 900),
			error: (part as { errorText?: string }).errorText,
			failed:
				part.state === 'output-error' ||
				(part.state === 'output-available' && output?.ok === false),
		})
	}
	return { text: text.trim(), tools }
}

async function sendSegment(
	chat: Chat<UIMessage>,
	text: string,
	timeoutMs: number,
	canvasId: string,
): Promise<{ timedOut: boolean; error?: string }> {
	let timedOut = false
	const timer = setTimeout(() => {
		timedOut = true
		chat.stop()
	}, timeoutMs)
	try {
		await chat.sendMessage({ text }, { body: { selection: [], mode: 'lecture', canvasId } })
		return { timedOut, error: chat.error?.message }
	} catch (error) {
		return { timedOut, error: (error as Error).message }
	} finally {
		clearTimeout(timer)
	}
}

async function sendSummary(
	chat: Chat<UIMessage>,
	timeoutMs: number,
	canvasId: string,
): Promise<{ timedOut: boolean; error?: string }> {
	const instruction = POST_SESSION_SUMMARY_PROMPT
	let timedOut = false
	const timer = setTimeout(() => {
		timedOut = true
		chat.stop()
	}, timeoutMs)
	try {
		await chat.sendMessage(
			{ text: instruction },
			{ body: { selection: [], mode: 'chat', canvasId } },
		)
		return { timedOut, error: chat.error?.message }
	} catch (error) {
		return { timedOut, error: (error as Error).message }
	} finally {
		clearTimeout(timer)
	}
}

async function listCanvases(): Promise<{ id: string; name: string }[]> {
	const data = (await (await api('/api/canvases?previews=0')).json()) as {
		canvases: { id: string; name: string }[]
		activeCanvasId: string
	}
	return data.canvases
}

async function createFreshCanvas(name: string): Promise<string> {
	const existing = (await listCanvases()).find((canvas) => canvas.name === name)
	if (existing) {
		await api(`/api/canvases/${encodeURIComponent(existing.id)}`, { method: 'DELETE' })
	}
	const data = (await (
		await api('/api/canvases', {
			method: 'POST',
			body: JSON.stringify({ name, activate: true }),
		})
	).json()) as { createdCanvasId: string }
	return data.createdCanvasId
}

async function restoreActive(id: string): Promise<void> {
	await api('/api/active-canvas', { method: 'PUT', body: JSON.stringify({ id }) }).catch(
		(error) => {
			log('restore active canvas failed', (error as Error).message)
		},
	)
}

async function runCase(
	caseEntry: CaseEntry,
	round: number,
	roundDeadline: number,
): Promise<CaseLog> {
	const short = caseEntry.title.length > 48 ? `${caseEntry.title.slice(0, 47)}…` : caseEntry.title
	const canvasName = `R${round}-${caseEntry.id.toUpperCase().split('-')[0]} ${short}`.slice(0, 80)
	const canvasId = await createFreshCanvas(canvasName)
	const logData: CaseLog = {
		round,
		case: caseEntry,
		canvasId,
		canvasName,
		startedAt: new Date().toISOString(),
		segments: [],
		stats: {},
	}
	const chat = new Chat({
		transport: new DefaultChatTransport({ api: `${BASE}/api/ai/chat` }),
	})
	const segments = buildSegments(caseEntry)
	const caseStart = Date.now()
	const caseDeadline = Math.min(caseStart + CASE_LIMIT_MS, roundDeadline)
	log(`case ${caseEntry.id} -> ${canvasName} (${segments.length} segments)`)

	for (let index = 0; index < segments.length; index++) {
		const remaining = caseDeadline - Date.now()
		if (remaining <= 1000) {
			logData.error = 'case deadline reached before all segments'
			break
		}
		const segment = segments[index]
		const text = `[Live session | ${caseEntry.subject} · ${caseEntry.title} | segment ${index + 1} | ${segment.start.toFixed(0)}–${segment.end.toFixed(0)}s] ${segment.text}`
		const started = Date.now()
		const beforeIds = new Set(chat.messages.map((message) => message.id))
		const result = await sendSegment(chat, text, Math.min(SEGMENT_TIMEOUT_MS, remaining), canvasId)
		const inspected = inspectAssistant(chat, beforeIds)
		const entry: SegmentLog = {
			index: index + 1,
			start: Number(segment.start.toFixed(1)),
			end: Number(segment.end.toFixed(1)),
			text: segment.text,
			elapsedMs: Date.now() - started,
			timedOut: result.timedOut,
			error: result.error,
			textReply: inspected.text,
			waits: /^wait[.!。]?$/i.test(inspected.text),
			tools: inspected.tools,
			status: String(chat.status),
		}
		logData.segments.push(entry)
		const failed = inspected.tools.filter((tool) => tool.failed).length
		log(
			`  ${String(index + 1).padStart(2)}/${segments.length} ${entry.elapsedMs}ms tools=${inspected.tools.length} fail=${failed} wait=${entry.waits ? 'Y' : 'n'} ${result.timedOut ? 'TIMEOUT' : ''} ${result.error ?? ''}`,
		)
		writeFileSync(join(OUT, `${caseEntry.id}.json`), `${JSON.stringify(logData, null, 2)}\n`)
	}

	const summaryRemaining = caseDeadline - Date.now()
	if (!logData.error && summaryRemaining <= 5000) {
		logData.error = 'summary skipped: case deadline'
	}
	if (!logData.error && summaryRemaining > 5000) {
		log(`  summary for ${caseEntry.id}`)
		const started = Date.now()
		const beforeIds = new Set(chat.messages.map((message) => message.id))
		const result = await sendSummary(chat, Math.min(SUMMARY_TIMEOUT_MS, summaryRemaining), canvasId)
		const inspected = inspectAssistant(chat, beforeIds)
		logData.summary = {
			index: logData.segments.length + 1,
			start: caseEntry.duration,
			end: caseEntry.duration,
			text: '[Post-meeting summary]',
			elapsedMs: Date.now() - started,
			timedOut: result.timedOut,
			error: result.error,
			textReply: inspected.text,
			waits: false,
			tools: inspected.tools,
			status: String(chat.status),
		}
	}
	try {
		const canvas = (await (await api(`/api/canvases/${encodeURIComponent(canvasId)}`)).json()) as {
			board: unknown
		}
		logData.finalBoard = canvas.board
	} catch (error) {
		logData.error = `${logData.error ?? ''} final board read failed: ${(error as Error).message}`
	}
	logData.stats = caseStats(logData)
	writeFileSync(join(OUT, `${caseEntry.id}.json`), `${JSON.stringify(logData, null, 2)}\n`)
	log(`case ${caseEntry.id} done in ${Math.round((Date.now() - caseStart) / 1000)}s`)
	return logData
}

function caseStats(log: CaseLog): Record<string, unknown> {
	const tools = log.segments.flatMap((segment) => segment.tools)
	const summaryTools = log.summary?.tools ?? []
	const board = log.finalBoard as
		| { shapes?: { type: string; text?: string; w?: number; h?: number; x?: number; y?: number }[] }
		| undefined
	const shapes = board?.shapes ?? []
	const toolNames: Record<string, number> = {}
	for (const tool of [...tools, ...summaryTools]) {
		toolNames[tool.name] = (toolNames[tool.name] ?? 0) + 1
	}
	return {
		segments: log.segments.length,
		requests: log.segments.length + (log.summary ? 1 : 0),
		timedOutSegments: log.segments.filter((segment) => segment.timedOut).length,
		failedTools: [...tools, ...summaryTools].filter((tool) => tool.failed).length,
		waits: log.segments.filter((segment) => segment.waits).length,
		toolNames,
		shapes: shapes.length,
		shapeTypes: shapes.reduce<Record<string, number>>((counts, shape) => {
			counts[shape.type] = (counts[shape.type] ?? 0) + 1
			return counts
		}, {}),
		htmlCards: shapes.filter((shape) => shape.type === 'html').length,
		totalReplyChars: log.segments.reduce((sum, segment) => sum + segment.textReply.length, 0),
		totalMs:
			log.segments.reduce((sum, segment) => sum + segment.elapsedMs, 0) +
			(log.summary?.elapsedMs ?? 0),
	}
}

async function main(): Promise<void> {
	mkdirSync(OUT, { recursive: true })
	const manifest = JSON.parse(readFileSync('evals/cases/catalog.json', 'utf8')) as CaseEntry[]
	const durations = JSON.parse(readFileSync('public/evals/manifest.json', 'utf8')) as {
		evals: { id: string; duration: number }[]
	}
	const cases = manifest
		.filter((entry) => !ONLY || ONLY.includes(entry.id))
		.map((entry) => ({
			...entry,
			duration: durations.evals.find((item) => item.id === entry.id)?.duration ?? 240,
		}))
	const state = (await (await api('/api/state')).json()) as { activeCanvasId: string }
	const initialActive = state.activeCanvasId
	const roundStart = Date.now()
	const roundDeadline = roundStart + ROUND_LIMIT_MS
	const results: CaseLog[] = []
	const failures: { id: string; title: string; error: string }[] = []
	const attempted = new Set<string>()
	let previousCases: { id: string; [key: string]: unknown }[] = []
	try {
		const previous = JSON.parse(readFileSync(join(OUT, 'summary.json'), 'utf8')) as {
			cases?: { id: string; [key: string]: unknown }[]
		}
		previousCases = previous.cases ?? []
	} catch {
		// No previous summary for this round.
	}
	try {
		for (const entry of cases) {
			if (Date.now() >= roundDeadline) {
				log('round timeout; stopping before', entry.id)
				break
			}
			attempted.add(entry.id)
			try {
				results.push(await runCase(entry, ROUND, roundDeadline))
			} catch (error) {
				const message = (error as Error).message
				log('case failed', entry.id, message)
				failures.push({ id: entry.id, title: entry.title, error: message })
				writeFileSync(
					join(OUT, `${entry.id}.error.txt`),
					`${new Date().toISOString()}\n${(error as Error).stack ?? ''}\n`,
				)
			}
		}
	} finally {
		await restoreActive(initialActive)
	}
	const summary = {
		round: ROUND,
		startedAt: new Date(roundStart).toISOString(),
		elapsedMinutes: Number(((Date.now() - roundStart) / 60_000).toFixed(1)),
		cases: [
			...previousCases.filter((previous) => !attempted.has(previous.id)),
			...failures,
			...results.map((result) => ({
				id: result.case.id,
				title: result.case.title,
				canvas: result.canvasName,
				canvasId: result.canvasId,
				error: result.error,
				...result.stats,
			})),
		],
	}
	writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
	log('round summary', JSON.stringify(summary, null, 2))
}

await main()
