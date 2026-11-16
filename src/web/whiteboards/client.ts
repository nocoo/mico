import type { WhiteboardJoin, WhiteboardSession } from '../../shared/whiteboards'

let active: { input: WhiteboardJoin; session: WhiteboardSession } | null = null

export function whiteboardDestination(search: string): string | undefined {
	const input = new URLSearchParams(search)
	if (!input.has('whiteboardid') && !input.has('whiteboards')) return
	const output = new URLSearchParams()
	for (const key of ['whiteboards', 'whiteboardid', 'username', 'sharer']) {
		const value = input.get(key)
		if (value !== null) output.set(key, value)
	}
	return `/?${output}`
}

export async function joinWhiteboard(
	input: WhiteboardJoin,
	signal?: AbortSignal,
): Promise<WhiteboardSession> {
	const response = await fetch('/api/whiteboards/join', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
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

export function configureWhiteboard(input: WhiteboardJoin, session: WhiteboardSession) {
	active = { input, session }
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
	if (!active) return path.toString()
	const url = new URL(path, window.location.href)
	if (url.pathname === '/mai/realtime' || url.pathname === '/moss')
		url.pathname = `/api/whiteboard-voice${url.pathname}`
	url.searchParams.set('whiteboardSession', active.session.token)
	return url.toString()
}

export const canvasFetch: typeof fetch = (input, init) => {
	if (!active) return fetch(input, init)
	const url = new URL(input instanceof Request ? input.url : input.toString(), window.location.href)
	if (
		url.origin !== window.location.origin ||
		(!url.pathname.startsWith('/api/') && url.pathname !== '/mai/config')
	)
		return fetch(input, init)
	const headers = new Headers(input instanceof Request ? input.headers : undefined)
	new Headers(init?.headers).forEach((value, key) => {
		headers.set(key, value)
	})
	headers.set('X-Mico-Whiteboard', active.session.token)
	return fetch(input, { ...init, headers })
}
