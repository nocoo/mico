import { isToolUIPart, type UIMessage } from 'ai'

const DEFAULT_HOT_MIN = 8
const DEFAULT_CHUNK_SIZE = 12
const MAX_ARCHIVE_CHUNK_LINES = 12
const MAX_ARCHIVE_BYTES = 2400
const COMPACT_HTML_THRESHOLD = 300
const COMPACT_HTML_STUB = '[html compacted; inspect with get_board(ids, include_html: true)]'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectShapeIds(value: unknown, ids: Set<string>): void {
	if (!Array.isArray(value)) return
	for (const entry of value) {
		if (isRecord(entry) && typeof entry.id === 'string' && entry.id.length > 0) {
			ids.add(entry.id)
		}
	}
}

function stripSegmentHeader(text: string): string {
	return text.replace(/^\[[^\]]+\]\s*/g, '').trim()
}

function summarizeChunk(chunkIndex: number, messages: readonly UIMessage[]): string {
	const userSnippets: string[] = []
	const tools = new Set<string>()
	const touchedIds = new Set<string>()

	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type === 'text' && message.role === 'user') {
				const clean = stripSegmentHeader(part.text)
				if (clean.length > 0) userSnippets.push(clean.slice(0, 48))
				continue
			}
			if (!isToolUIPart(part)) continue
			tools.add(part.type.replace(/^tool-/, ''))
			const record = part as unknown as { input?: unknown; output?: unknown }
			if (isRecord(record.output)) {
				collectShapeIds(record.output.created, touchedIds)
				collectShapeIds(record.output.updated, touchedIds)
			}
			if (isRecord(record.input)) {
				collectShapeIds(record.input.cards, touchedIds)
				collectShapeIds(record.input.updates, touchedIds)
				collectShapeIds(record.input.notes, touchedIds)
				collectShapeIds(record.input.boxes, touchedIds)
				collectShapeIds(record.input.frames, touchedIds)
				if (typeof record.input.id === 'string') touchedIds.add(record.input.id)
			}
		}
	}

	const preview =
		userSnippets.length === 0
			? `${messages.length} msgs`
			: userSnippets.length === 1
				? userSnippets[0]
				: `${userSnippets[0]} .. ${userSnippets[userSnippets.length - 1]}`
	const toolList = [...tools].slice(0, 4).join(',')
	const idList = [...touchedIds].slice(0, 6).join(',')
	const detail = [preview, toolList ? `tools=[${toolList}]` : '', idList ? `ids=[${idList}]` : '']
		.filter(Boolean)
		.join(' ')
	const line = `- Chunk ${chunkIndex + 1} (${messages.length} msgs): ${detail}`
	return line.length <= 180 ? line : `${line.slice(0, 177)}...`
}

const utf8Encoder = new TextEncoder()

function buildArchivePrefix(archived: readonly UIMessage[], chunkSize: number): UIMessage[] {
	if (archived.length === 0) return []
	const lines: string[] = []
	for (let start = 0; start < archived.length; start += chunkSize) {
		const chunkIndex = Math.floor(start / chunkSize)
		lines.push(summarizeChunk(chunkIndex, archived.slice(start, start + chunkSize)))
	}
	const recentLines = lines.slice(-MAX_ARCHIVE_CHUNK_LINES)
	const rolledUp = Math.max(0, lines.length - recentLines.length)
	const bodyLines =
		rolledUp > 0
			? [`- Earlier ${rolledUp} chunk(s) already captured on board.`, ...recentLines]
			: recentLines
	let body = bodyLines.join('\n')
	if (utf8Encoder.encode(body).length > MAX_ARCHIVE_BYTES) {
		body = `${body.slice(0, MAX_ARCHIVE_BYTES - 3)}...`
	}
	return [
		{
			id: `compact-archive-${archived.length}`,
			role: 'user',
			parts: [
				{
					type: 'text',
					text: `[Archived session summary covering ${archived.length} earlier messages]\n${body}`,
				},
			],
		},
		{
			id: `compact-ack-${archived.length}`,
			role: 'assistant',
			parts: [{ type: 'text', text: 'Acknowledged archived session context.' }],
		},
	]
}

function slimHtmlField(entry: unknown): unknown {
	if (!isRecord(entry) || typeof entry.html !== 'string') return entry
	if (entry.html.length <= COMPACT_HTML_THRESHOLD) return entry
	return { ...entry, html: COMPACT_HTML_STUB }
}

function slimToolInput(toolType: string, input: unknown): unknown {
	if (!isRecord(input)) return input
	if (toolType === 'tool-add_html_cards' && Array.isArray(input.cards)) {
		return { ...input, cards: input.cards.map(slimHtmlField) }
	}
	if (toolType === 'tool-update_shapes' && Array.isArray(input.updates)) {
		return {
			...input,
			updates: input.updates.map((update) => {
				if (!isRecord(update) || !isRecord(update.patch)) return update
				return { ...update, patch: slimHtmlField(update.patch) }
			}),
		}
	}
	return input
}

function slimHotMessage(message: UIMessage): UIMessage {
	if (message.role !== 'assistant') return message
	let changed = false
	const parts = message.parts.map((part) => {
		if (!isToolUIPart(part)) return part
		const record = part as unknown as Record<string, unknown>
		let nextOutput = record.output
		let nextInput = record.input
		let partChanged = false

		if (
			part.type === 'tool-get_board' &&
			part.state === 'output-available' &&
			isRecord(record.output) &&
			'shapes' in record.output
		) {
			nextOutput = {
				ok: record.output.ok ?? true,
				revision: record.output.revision,
				count: record.output.count,
				compacted: true,
			}
			partChanged = true
		}

		const slimmedInput = slimToolInput(part.type, record.input)
		if (slimmedInput !== record.input) {
			nextInput = slimmedInput
			partChanged = true
		}

		if (!partChanged) return part
		changed = true
		return {
			...record,
			input: nextInput,
			...(nextOutput !== undefined ? { output: nextOutput } : {}),
		} as UIMessage['parts'][number]
	})
	return changed ? { ...message, parts } : message
}

export function compactUiMessages(
	messages: UIMessage[],
	options: { hotMin?: number; chunkSize?: number } = {},
): UIMessage[] {
	const hotMin = options.hotMin ?? DEFAULT_HOT_MIN
	const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
	const total = messages.length

	let archivedCount =
		total > hotMin + chunkSize ? Math.floor((total - hotMin) / chunkSize) * chunkSize : 0
	while (
		archivedCount > 0 &&
		archivedCount < total - 2 &&
		messages[archivedCount]?.role !== 'user'
	) {
		archivedCount++
	}

	const archived = messages.slice(0, archivedCount)
	const hot = messages.slice(archivedCount)
	const slimCount = hot.length > 4 ? Math.floor((hot.length - 4) / 4) * 4 : 0
	const compactedHot = hot.map((message, index) =>
		index < slimCount ? slimHotMessage(message) : message,
	)
	const prefix = buildArchivePrefix(archived, chunkSize)
	return prefix.length > 0 ? [...prefix, ...compactedHot] : compactedHot
}
