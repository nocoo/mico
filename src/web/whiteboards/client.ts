import { getQueryParam } from '../../shared/query.ts'
import type { WhiteboardJoin, WhiteboardSession } from '../../shared/whiteboards'

let active: { input: WhiteboardJoin; session: WhiteboardSession } | null = null

export function currentMeetingId(): string | null {
	if (typeof window === 'undefined') return null
	const raw = getQueryParam(window.location.search, 'meetingid')?.trim()
	return raw ? raw.slice(0, 256) : null
}

export async function joinWhiteboard(
	input: WhiteboardJoin,
	signal?: AbortSignal,
): Promise<WhiteboardSession> {
	const meetingId = currentMeetingId()
	const response = await fetch('/api/whiteboards/join', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(meetingId ? { 'X-Mico-Meeting': meetingId } : {}),
		},
		body: JSON.stringify(input),
		signal: signal
			? AbortSignal.any([signal, AbortSignal.timeout(10000)])
			: AbortSignal.timeout(10000),
	})
	if (!response.ok) {
		const error = (await response.json()) as { message: string }
		throw new Error(error.message)
	}
	return response.json() as Promise<WhiteboardSession>
}

export function configurePresence(input: WhiteboardJoin, session: WhiteboardSession) {
	active = { input, session }
}

export function updatePresenceSharer(sharer: boolean) {
	if (!active) return
	active.input = { ...active.input, sharer }
	active.session = {
		...active.session,
		member: { ...active.session.member, sharer },
	}
}

export function clearWhiteboard() {
	active = null
}

export async function reconnectWhiteboard() {
	if (!active) return
	const current = active
	const session = await joinWhiteboard(current.input)
	if (active === current) current.session = session
}

export function whiteboardUrl(path: string | URL): string {
	const meetingId = currentMeetingId()
	if (!active && !meetingId) return path.toString()
	const url = new URL(path, window.location.href)
	if (active) {
		if (url.pathname === '/mai/realtime' || url.pathname === '/moss')
			url.pathname = `/api/whiteboard-voice${url.pathname}`
		url.searchParams.set('whiteboardsession', active.session.token)
	}
	if (meetingId) {
		url.searchParams.set('meetingid', meetingId)
	}
	return url.toString()
}

export const canvasFetch: typeof fetch = (input, init) => {
	const meetingId = currentMeetingId()
	if (!active && !meetingId) return fetch(input, init)
	const url = new URL(input instanceof Request ? input.url : input.toString(), window.location.href)
	if (url.origin !== window.location.origin) return fetch(input, init)
	const isAiPath =
		url.pathname.startsWith('/api/ai/') ||
		url.pathname.startsWith('/api/moss/') ||
		url.pathname === '/mai/config'
	const includeWhiteboard = Boolean(active && isAiPath)
	if (!includeWhiteboard && !meetingId) return fetch(input, init)
	const headers = new Headers(input instanceof Request ? input.headers : undefined)
	new Headers(init?.headers).forEach((value, key) => {
		headers.set(key, value)
	})
	if (includeWhiteboard && active) headers.set('X-Mico-Whiteboard', active.session.token)
	if (meetingId) headers.set('X-Mico-Meeting', meetingId)
	return fetch(input, { ...init, headers })
}
