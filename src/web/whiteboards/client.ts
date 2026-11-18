import type { WhiteboardJoin, WhiteboardSession } from '../../shared/whiteboards'

type PresenceJoin = WhiteboardJoin & { persistIdentity?: boolean }

let active: { input: PresenceJoin; session: WhiteboardSession } | null = null

function participantKey(): string {
	try {
		const stored = localStorage.getItem('mico.demo.participantKey')
		if (stored) {
			if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(stored))
				throw new Error('Saved demo participant key is invalid')
			return stored
		}
		const key = crypto.randomUUID()
		localStorage.setItem('mico.demo.participantKey', key)
		return key
	} catch (error) {
		throw new Error('Demo ownership needs browser storage. Enable storage and reload to join.', {
			cause: error,
		})
	}
}

export async function joinWhiteboard(
	{ persistIdentity, ...input }: PresenceJoin,
	signal?: AbortSignal,
): Promise<WhiteboardSession> {
	const response = await fetch('/api/whiteboards/join', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			...input,
			participantKey: input.participantKey ?? (persistIdentity ? participantKey() : undefined),
		}),
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

export function configurePresence(input: PresenceJoin, session: WhiteboardSession) {
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
	const isAiPath =
		url.pathname.startsWith('/api/ai/') ||
		url.pathname.startsWith('/api/moss/') ||
		url.pathname === '/mai/config'
	const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
	const isCanvasMutation =
		(url.pathname === '/api/operations' && method === 'POST') ||
		(/^\/api\/canvases\/[^/]+\/permissions$/.test(url.pathname) && method === 'PUT') ||
		(url.pathname === '/api/canvases' && method === 'POST') ||
		(url.pathname === '/api/active-canvas' && method === 'PUT') ||
		(/^\/api\/canvases\/[^/]+$/.test(url.pathname) && (method === 'PATCH' || method === 'DELETE'))
	if ((!isAiPath && !isCanvasMutation) || url.origin !== window.location.origin)
		return fetch(input, init)
	const headers = new Headers(input instanceof Request ? input.headers : undefined)
	new Headers(init?.headers).forEach((value, key) => {
		headers.set(key, value)
	})
	headers.set('X-Mico-Whiteboard', active.session.token)
	return fetch(input, { ...init, headers })
}
