import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
	canvasFetch,
	clearWhiteboard,
	configurePresence,
	currentMeetingId,
	joinWhiteboard,
	reconnectWhiteboard,
	updatePresenceSharer,
	whiteboardUrl,
} from './client.ts'

const originalWindow = globalThis.window
const originalFetch = globalThis.fetch
const originalLocalStorage = globalThis.localStorage

function installBrowserEnv(search = '', storedKey?: string | Error) {
	const storage = new Map<string, string>()
	if (typeof storedKey === 'string') storage.set('mico.demo.participantKey', storedKey)
	const localStorageMock = {
		getItem(key: string) {
			if (storedKey instanceof Error) throw storedKey
			return storage.get(key) ?? null
		},
		setItem(key: string, value: string) {
			if (storedKey instanceof Error) throw storedKey
			storage.set(key, value)
		},
	}
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			location: { href: `https://mico.example/${search}`, origin: 'https://mico.example', search },
		},
	})
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: localStorageMock,
	})
	return storage
}

afterEach(() => {
	clearWhiteboard()
	if (originalWindow === undefined) delete (globalThis as { window?: Window }).window
	else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
	if (originalFetch === undefined) delete (globalThis as { fetch?: typeof fetch }).fetch
	else Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch })
	if (originalLocalStorage === undefined) {
		delete (globalThis as { localStorage?: Storage }).localStorage
	} else {
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			value: originalLocalStorage,
		})
	}
})

test('joinWhiteboard sends meeting-scoped request, persists participantKey and surfaces errors', async () => {
	const storage = installBrowserEnv('?meetingid=room-42')
	assert.equal(currentMeetingId(), 'room-42')

	const requests: Array<{ url: string; body: Record<string, unknown> }> = []
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({
				url: String(input),
				body: JSON.parse(String(init?.body)) as Record<string, unknown>,
			})
			return new Response(
				JSON.stringify({
					token: 'wb-tok-1',
					whiteboardid: 'demo',
					member: { id: 'm1', username: 'Ada', sharer: true, color: '#00a2e1', cursor: null },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			)
		},
	})

	const session = await joinWhiteboard({
		whiteboardid: 'demo',
		username: 'Ada',
		sharer: true,
		clientId: '11111111-1111-4111-8111-111111111111',
		persistIdentity: true,
	})
	assert.equal(session.token, 'wb-tok-1')
	assert.equal(requests[0].url, '/api/whiteboards/join?meetingid=room-42')
	const savedKey = storage.get('mico.demo.participantKey')
	assert.ok(savedKey && requests[0].body.participantKey === savedKey)

	// Reuses persisted key on subsequent joins
	await joinWhiteboard({
		whiteboardid: 'demo',
		username: 'Ada',
		sharer: true,
		clientId: '11111111-1111-4111-8111-111111111111',
		persistIdentity: true,
	})
	assert.equal(requests[1].body.participantKey, savedKey)

	// Error response surfaces server message
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async () =>
			new Response(JSON.stringify({ message: 'Room full' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			}),
	})
	await assert.rejects(
		joinWhiteboard({
			whiteboardid: 'demo',
			username: 'Ada',
			sharer: false,
			clientId: '11111111-1111-4111-8111-111111111111',
		}),
		/Room full/,
	)

	// Invalid or restricted storage throws actionable error
	installBrowserEnv('', 'not-a-uuid')
	await assert.rejects(
		joinWhiteboard({
			whiteboardid: 'demo',
			username: 'Ada',
			sharer: false,
			clientId: '11111111-1111-4111-8111-111111111111',
			persistIdentity: true,
		}),
		/Demo ownership needs browser storage/,
	)
})

test('whiteboardUrl and canvasFetch scope tokens and meetingid only to appropriate routes', async () => {
	installBrowserEnv('?meetingid=team-a')
	assert.equal(whiteboardUrl('/api/board'), 'https://mico.example/api/board?meetingid=team-a')

	const joinInput = {
		whiteboardid: 'demo',
		username: 'Ada',
		sharer: false,
		clientId: '11111111-1111-4111-8111-111111111111',
	}
	const session = {
		token: 'tok-initial',
		whiteboardid: 'demo',
		member: { id: 'm1', username: 'Ada', sharer: false, color: '#00a2e1', cursor: null },
	}
	configurePresence(joinInput, session)
	updatePresenceSharer(true)

	assert.equal(
		whiteboardUrl('/mai/realtime'),
		'https://mico.example/api/whiteboard-voice/mai/realtime?whiteboardsession=tok-initial&meetingid=team-a',
	)
	assert.equal(
		whiteboardUrl('/moss'),
		'https://mico.example/api/whiteboard-voice/moss?whiteboardsession=tok-initial&meetingid=team-a',
	)

	const calls: Array<{ url: string; wbHeader: string | null }> = []
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async (input: string | URL | Request, init?: RequestInit) => {
			if (String(input).includes('/api/whiteboards/join')) {
				return new Response(JSON.stringify({ ...session, token: 'tok-reconnected' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			}
			const url = input instanceof Request ? input.url : String(input)
			const headers = new Headers(
				init?.headers ?? (input instanceof Request ? input.headers : undefined),
			)
			calls.push({ url, wbHeader: headers.get('X-Mico-Whiteboard') })
			return new Response(null, { status: 200 })
		},
	})

	await reconnectWhiteboard()

	await canvasFetch('/api/operations', { method: 'POST', body: '{}' })
	await canvasFetch('/api/ai/chat', { method: 'POST', body: '{}' })
	await canvasFetch('/api/board')
	await canvasFetch('https://other.example/external')
	await canvasFetch(new Request('https://mico.example/api/canvases/c1', { method: 'DELETE' }))

	assert.deepEqual(calls, [
		{ url: 'https://mico.example/api/operations?meetingid=team-a', wbHeader: 'tok-reconnected' },
		{ url: 'https://mico.example/api/ai/chat?meetingid=team-a', wbHeader: 'tok-reconnected' },
		{ url: 'https://mico.example/api/board?meetingid=team-a', wbHeader: null },
		{ url: 'https://other.example/external', wbHeader: null },
		{ url: 'https://mico.example/api/canvases/c1?meetingid=team-a', wbHeader: 'tok-reconnected' },
	])

	clearWhiteboard()
	installBrowserEnv('')
	assert.equal(whiteboardUrl('/api/board'), '/api/board')
})
