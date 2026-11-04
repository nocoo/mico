export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
	id: string
	role: ChatRole
	text: string
}

export const AI_GREETING =
	'Hi — I am Mico. Ask me to sketch a flow, tidy the board or explain what is here.'

const PREVIEW_SUFFIX =
	'This panel is an interface preview; the board stays untouched until the assistant backend is connected.'

export function normalizePrompt(input: string): string | null {
	const text = input.trim()
	return text.length === 0 ? null : text
}

export function mockReply(prompt: string): string {
	const text = normalizePrompt(prompt)
	if (!text) return PREVIEW_SUFFIX
	const subject = text.length > 72 ? `${text.slice(0, 69).trimEnd()}…` : text
	return `Got it — “${subject}”\n\n${PREVIEW_SUFFIX}`
}

export function formatDuration(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds))
	return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}
