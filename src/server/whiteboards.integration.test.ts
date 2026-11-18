import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import WebSocket, { WebSocketServer } from 'ws'
import { DEV_ORIGIN } from '../shared/config.ts'
import type { CanvasSnapshot, ServerEvent } from '../shared/types.ts'
import type { PresenceEvent, WhiteboardSession } from '../shared/whiteboards.ts'
import { createDaemon } from './index.ts'

type Event = ServerEvent | PresenceEvent

function subscribe(url: string, session?: WhiteboardSession) {
	const socket = new WebSocket(
		`${url.replace('http:', 'ws:')}/api/events${session ? `?whiteboardSession=${session.token}` : ''}`,
		{ headers: { origin: DEV_ORIGIN } },
	)
	const events: Event[] = []
	socket.on('message', (data) => events.push(JSON.parse(data.toString()) as Event))
	const next = async (predicate: (event: Event) => boolean): Promise<Event> => {
		const deadline = Date.now() + 5000
		while (Date.now() < deadline) {
			const index = events.findIndex(predicate)
			if (index >= 0) return events.splice(index, 1)[0]
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
		throw new Error(`Missing socket event; received ${JSON.stringify(events)}`)
	}
	return { socket, events, next }
}

async function withDemoServer(
	run: (context: { baseUrl: string; wsUrl: string }) => Promise<void>,
	options: {
		env?: Record<string, string>
		createUpstream?: () => WebSocket
	} = {},
) {
	const directory = mkdtempSync(join(tmpdir(), 'mico-demo-presence-'))
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'settings.json'),
		...(options.createUpstream
			? {
					createMaiUpstream: options.createUpstream,
					createMossUpstream: options.createUpstream,
				}
			: {}),
		env: {
			MICO_AUTH_MODE: 'demo',
			MICO_AI_ENABLED: 'false',
			...options.env,
		},
	})
	try {
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening')
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		await run({
			baseUrl: `http://127.0.0.1:${address.port}`,
			wsUrl: `ws://127.0.0.1:${address.port}`,
		})
	} finally {
		await daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

async function joinDemo(
	baseUrl: string,
	input: { username: string; sharer: boolean; clientId: string; participantKey?: string },
) {
	return fetch(`${baseUrl}/api/whiteboards/join`, {
		method: 'POST',
		headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
		body: JSON.stringify({ whiteboardid: 'demo', ...input }),
	})
}

test('demo object ownership follows participant identity and presenter grants reach connected guests', async () => {
	await withDemoServer(async ({ baseUrl }) => {
		const key = randomUUID()
		const join = async (username: string, sharer: boolean, participantKey?: string) => {
			const response = await joinDemo(baseUrl, {
				username,
				sharer,
				clientId: randomUUID(),
				participantKey,
			})
			assert.equal(response.status, 200)
			return (await response.json()) as WhiteboardSession
		}
		const alice = await join('Alice', false, key)
		const bob = await join('Bob', false)
		const host = await join('Presenter', true)
		const request = (path: string, method: string, body: unknown, session?: WhiteboardSession) =>
			fetch(`${baseUrl}${path}`, {
				method,
				headers: {
					origin: DEV_ORIGIN,
					'Content-Type': 'application/json',
					...(session ? { 'X-Mico-Whiteboard': session.token } : {}),
				},
				body: JSON.stringify(body),
			})
		const created = await request(
			'/api/operations',
			'POST',
			{
				operations: [
					{
						type: 'create',
						shape: {
							id: 'alice-note',
							type: 'note',
							x: 10,
							y: 10,
							w: 80,
							h: 80,
							color: '#fff8d4',
							text: 'Alice',
						},
					},
				],
			},
			alice,
		)
		assert.equal(created.status, 200)
		const edit = { operations: [{ type: 'update', id: 'alice-note', patch: { text: 'Changed' } }] }
		assert.equal((await request('/api/operations', 'POST', edit)).status, 403)
		assert.equal((await request('/api/operations', 'POST', edit, bob)).status, 403)
		const returning = await join('Alice renamed', false, key)
		assert.equal(returning.member.participantId, alice.member.participantId)
		assert.notEqual(returning.member.id, alice.member.id)
		assert.equal((await request('/api/operations', 'POST', edit, returning)).status, 200)
		const subscriber = subscribe(baseUrl, bob)
		try {
			const snapshot = await subscriber.next((event) => event.type === 'snapshot')
			assert.equal(snapshot.type, 'snapshot')
			const path = `/api/canvases/${snapshot.activeCanvasId}/permissions`
			const grant = { participantId: bob.member.participantId, allowed: true }
			assert.equal((await request(path, 'PUT', grant, bob)).status, 403)
			assert.equal((await request(path, 'PUT', grant, host)).status, 200)
			await subscriber.next(
				(event) =>
					event.type === 'snapshot' &&
					Boolean(event.canvasEditorIds?.includes(bob.member.participantId ?? '')),
			)
			assert.equal((await request('/api/operations', 'POST', edit, bob)).status, 200)
			assert.equal((await request(path, 'PUT', { ...grant, allowed: false }, host)).status, 200)
			await subscriber.next(
				(event) => event.type === 'snapshot' && event.canvasEditorIds?.length === 0,
			)
			assert.equal((await request('/api/operations', 'POST', edit, bob)).status, 403)
			assert.equal((await request('/api/operations', 'POST', edit, returning)).status, 200)
		} finally {
			subscriber.socket.terminate()
		}
	})
})

test('demo presenters manage canvases and broadcast active-canvas snapshots', async () => {
	await withDemoServer(async ({ baseUrl }) => {
		const joined = await joinDemo(baseUrl, {
			username: 'Presenter',
			sharer: true,
			clientId: randomUUID(),
		})
		assert.equal(joined.status, 200)
		const member = (await joined.json()) as WhiteboardSession
		const request = (path: string, method = 'GET', body?: unknown) =>
			fetch(`${baseUrl}${path}`, {
				method,
				headers: {
					origin: DEV_ORIGIN,
					'Content-Type': 'application/json',
					'X-Mico-Whiteboard': member.token,
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			})
		const viewer = subscribe(baseUrl, member)
		try {
			const initial = await viewer.next((event) => event.type === 'snapshot')
			assert.equal(initial.type, 'snapshot')
			const listed = await request('/api/canvases')
			assert.equal(listed.status, 200)
			assert.equal((await listed.json()).canvases.length, 1)

			const response = await request('/api/canvases', 'POST', {
				name: 'Second demo canvas',
				activate: true,
			})
			assert.equal(response.status, 200)
			const created = (await response.json()) as CanvasSnapshot & { createdCanvasId: string }
			const id = created.createdCanvasId
			assert.notEqual(id, initial.activeCanvasId)
			await viewer.next((event) => event.type === 'snapshot' && event.activeCanvasId === id)
			const anonymousState = (await (await fetch(`${baseUrl}/api/state`)).json()) as CanvasSnapshot
			assert.equal(anonymousState.activeCanvasId, id)
			assert.equal(anonymousState.canvases.length, 2)

			assert.equal(
				(await request(`/api/canvases/${id}`, 'PATCH', { name: 'Renamed demo canvas' })).status,
				200,
			)
			const edited = await request('/api/operations', 'POST', {
				canvasId: id,
				operations: [
					{
						type: 'create',
						shape: {
							id: 'second-canvas-note',
							type: 'note',
							x: 10,
							y: 10,
							w: 80,
							h: 80,
							color: '#fff8d4',
							text: 'Kept on the second canvas',
						},
					},
				],
			})
			assert.equal(edited.status, 200)
			assert.equal(
				(await request('/api/active-canvas', 'PUT', { id: initial.activeCanvasId })).status,
				200,
			)
			const switched = await viewer.next(
				(event) => event.type === 'snapshot' && event.activeCanvasId === initial.activeCanvasId,
			)
			assert.equal(switched.type, 'snapshot')
			assert.equal(switched.board.shapes.length, 0)
			const detail = await request(`/api/canvases/${id}`)
			assert.equal(detail.status, 200)
			const saved = await detail.json()
			assert.equal(saved.canvas.name, 'Renamed demo canvas')
			assert.equal(saved.board.shapes[0].id, 'second-canvas-note')
			assert.equal((await request(`/api/canvases/${id}`, 'DELETE')).status, 200)
			const remaining = await request('/api/canvases')
			assert.equal((await remaining.json()).canvases.length, 1)
		} finally {
			viewer.socket.terminate()
		}
	})
})

test('demo canvas management rejects guests and missing sessions without changing shared state', async () => {
	await withDemoServer(async ({ baseUrl }) => {
		const request = (path: string, method = 'GET', body?: unknown, token?: string) =>
			fetch(`${baseUrl}${path}`, {
				method,
				headers: {
					origin: DEV_ORIGIN,
					'Content-Type': 'application/json',
					...(token ? { 'X-Mico-Whiteboard': token } : {}),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			})
		const guestResponse = await joinDemo(baseUrl, {
			username: 'Guest',
			sharer: false,
			clientId: randomUUID(),
		})
		assert.equal(guestResponse.status, 200)
		const guest = (await guestResponse.json()) as WhiteboardSession
		const initial = (await (await request('/api/state')).json()) as CanvasSnapshot
		const create = { name: 'Blocked canvas', activate: true }
		for (const token of [undefined, guest.token]) {
			const response = await request('/api/canvases', 'POST', create, token)
			assert.equal(response.status, 403)
			const error = await response.json()
			assert.equal(error.error, 'WHITEBOARD_READ_ONLY')
			assert.match(error.message, /Only the presenter.*Workspace profile/)
		}

		const presenterClientId = randomUUID()
		const presenterResponse = await joinDemo(baseUrl, {
			username: 'Presenter',
			sharer: true,
			clientId: presenterClientId,
		})
		assert.equal(presenterResponse.status, 200)
		const presenter = (await presenterResponse.json()) as WhiteboardSession
		const created = await request(
			'/api/canvases',
			'POST',
			{ name: 'Presenter canvas', activate: true },
			presenter.token,
		)
		assert.equal(created.status, 200)
		const state = (await created.json()) as CanvasSnapshot
		const otherRoomResponse = await request('/api/whiteboards/join', 'POST', {
			whiteboardid: 'another-room',
			username: 'Other presenter',
			sharer: true,
			clientId: randomUUID(),
		})
		assert.equal(otherRoomResponse.status, 200)
		const otherRoom = (await otherRoomResponse.json()) as WhiteboardSession
		for (const token of [undefined, guest.token, otherRoom.token]) {
			for (const [path, method, body] of [
				['/api/canvases', 'POST', create],
				['/api/active-canvas', 'PUT', { id: initial.activeCanvasId }],
				[`/api/canvases/${state.activeCanvasId}`, 'PATCH', { name: 'Blocked rename' }],
				[`/api/canvases/${state.activeCanvasId}`, 'DELETE', undefined],
			] as const) {
				const response = await request(path, method, body, token)
				assert.equal(response.status, 403, `${method} ${path}`)
				assert.match((await response.json()).message, /Only the presenter.*Workspace profile/)
			}
			assert.equal((await request('/api/canvases', 'GET', undefined, token)).status, 200)
			assert.equal(
				(await request(`/api/canvases/${state.activeCanvasId}`, 'GET', undefined, token)).status,
				200,
			)
		}
		assert.equal((await request('/api/canvases', 'POST', create, randomUUID())).status, 401)
		const unchanged = (await (await request('/api/state')).json()) as CanvasSnapshot
		assert.equal(unchanged.stateVersion, state.stateVersion)
		assert.equal(unchanged.activeCanvasId, state.activeCanvasId)
		assert.deepEqual(unchanged.canvases, state.canvases)

		const steppedDown = await joinDemo(baseUrl, {
			username: 'Presenter',
			sharer: false,
			clientId: presenterClientId,
		})
		assert.equal(steppedDown.status, 200)
		assert.equal((await request('/api/canvases', 'POST', create, presenter.token)).status, 403)
	})
})

function nextPresence(
	socket: WebSocket,
	predicate: (event: PresenceEvent) => boolean,
): Promise<PresenceEvent> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.off('message', onMessage)
			reject(new Error('Timed out waiting for presence event'))
		}, 4000)
		const onMessage = (data: WebSocket.RawData) => {
			const parsed = JSON.parse(data.toString()) as PresenceEvent | { type: string }
			if (
				(parsed.type === 'presence' ||
					parsed.type === 'cursor' ||
					parsed.type === 'presenter-view') &&
				predicate(parsed as PresenceEvent)
			) {
				clearTimeout(timeout)
				socket.off('message', onMessage)
				resolve(parsed as PresenceEvent)
			}
		}
		socket.on('message', onMessage)
	})
}

test('demo presence tracks cursors, presenter view, profile updates, and allows all members to draw', async () => {
	await withDemoServer(async ({ baseUrl, wsUrl }) => {
		const presenterClientId = randomUUID()
		const viewerClientId = randomUUID()

		const pRes = await joinDemo(baseUrl, {
			username: 'Jason',
			sharer: true,
			clientId: presenterClientId,
		})
		assert.equal(pRes.status, 200)
		const presenter = (await pRes.json()) as WhiteboardSession

		const vRes = await joinDemo(baseUrl, {
			username: 'Guest',
			sharer: false,
			clientId: viewerClientId,
		})
		assert.equal(vRes.status, 200)
		const viewer = (await vRes.json()) as WhiteboardSession

		const pSocket = new WebSocket(`${wsUrl}/api/events?whiteboardSession=${presenter.token}`, {
			headers: { origin: DEV_ORIGIN },
		})
		const vSocket = new WebSocket(`${wsUrl}/api/events?whiteboardSession=${viewer.token}`, {
			headers: { origin: DEV_ORIGIN },
		})
		try {
			await Promise.all([
				once(pSocket, 'open', { signal: AbortSignal.timeout(4000) }),
				once(vSocket, 'open', { signal: AbortSignal.timeout(4000) }),
			])

			const cursorPromise = nextPresence(
				vSocket,
				(event) => event.type === 'cursor' && event.memberId === presenter.member.id,
			)
			pSocket.send(JSON.stringify({ type: 'cursor', point: { x: 120, y: 240 } }))
			const cursorEvent = await cursorPromise
			assert.equal(cursorEvent.type, 'cursor')
			assert.deepEqual(cursorEvent.point, { x: 120, y: 240 })

			const viewPromise = nextPresence(vSocket, (event) => event.type === 'presenter-view')
			pSocket.send(
				JSON.stringify({
					type: 'presenter-view',
					viewport: { centerX: 50, centerY: 60, zoom: 1.5 },
				}),
			)
			const viewEvent = await viewPromise
			assert.equal(viewEvent.type, 'presenter-view')
			assert.deepEqual(viewEvent.viewport, { centerX: 50, centerY: 60, zoom: 1.5 })

			// Non-presenter in demo mode can still draw
			const opRes = await fetch(`${baseUrl}/api/operations?whiteboardSession=${viewer.token}`, {
				method: 'POST',
				headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					operations: [
						{
							type: 'create',
							shape: {
								id: 'viewer-note',
								type: 'note',
								x: 10,
								y: 10,
								w: 80,
								h: 80,
								color: '#fff8d4',
								text: 'Viewer can draw',
							},
						},
					],
				}),
			})
			assert.equal(opRes.status, 200)

			// Viewer can update their own name in-place
			const renamePromise = nextPresence(
				pSocket,
				(event) => event.type === 'presence' && event.members.some((m) => m.username === 'Ada'),
			)
			const renamed = await joinDemo(baseUrl, {
				username: 'Ada',
				sharer: false,
				clientId: viewerClientId,
			})
			assert.equal(renamed.status, 200)
			await renamePromise

			// Second presenter is rejected while presenter is active
			const conflict = await joinDemo(baseUrl, {
				username: 'Ada',
				sharer: true,
				clientId: viewerClientId,
			})
			assert.equal(conflict.status, 409)
			assert.equal((await conflict.json()).error, 'PRESENTER_EXISTS')

			// Releasing presenter allows Ada to become presenter
			const steppedDown = await joinDemo(baseUrl, {
				username: 'Jason',
				sharer: false,
				clientId: presenterClientId,
			})
			assert.equal(steppedDown.status, 200)
			const promoted = await joinDemo(baseUrl, {
				username: 'Ada',
				sharer: true,
				clientId: viewerClientId,
			})
			assert.equal(promoted.status, 200)
		} finally {
			pSocket.terminate()
			vSocket.terminate()
		}
	})
})

test('demo mode gates AI to presenter and handles presenter request, decline, and transfer', async () => {
	const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 })
	upstream.on('connection', (socket) => socket.on('message', (data) => socket.send(data)))
	await once(upstream, 'listening')
	const upstreamAddress = upstream.address()
	assert.ok(upstreamAddress && typeof upstreamAddress !== 'string')
	try {
		await withDemoServer(
			async ({ baseUrl, wsUrl }) => {
				const jasonClientId = randomUUID()
				const adaClientId = randomUUID()
				const jasonRes = await joinDemo(baseUrl, {
					username: 'Jason',
					sharer: true,
					clientId: jasonClientId,
				})
				assert.equal(jasonRes.status, 200)
				const jason = (await jasonRes.json()) as WhiteboardSession

				const adaRes = await joinDemo(baseUrl, {
					username: 'Ada',
					sharer: false,
					clientId: adaClientId,
				})
				assert.equal(adaRes.status, 200)
				const ada = (await adaRes.json()) as WhiteboardSession

				const jasonSocket = new WebSocket(`${wsUrl}/api/events?whiteboardSession=${jason.token}`, {
					headers: { origin: DEV_ORIGIN },
				})
				const adaSocket = new WebSocket(`${wsUrl}/api/events?whiteboardSession=${ada.token}`, {
					headers: { origin: DEV_ORIGIN },
				})
				const sockets: WebSocket[] = [jasonSocket, adaSocket]
				try {
					const ready = nextPresence(
						jasonSocket,
						(event) =>
							event.type === 'presence' &&
							event.members.length === 2 &&
							event.presenterId === jason.member.id,
					)
					await Promise.all([
						once(jasonSocket, 'open', { signal: AbortSignal.timeout(4000) }),
						once(adaSocket, 'open', { signal: AbortSignal.timeout(4000) }),
					])
					await ready

					// Anonymous and non-presenter clients are blocked from AI endpoints
					for (const token of [undefined, ada.token]) {
						const chatRes = await fetch(`${baseUrl}/api/ai/chat`, {
							method: 'POST',
							headers: {
								origin: DEV_ORIGIN,
								'Content-Type': 'application/json',
								...(token ? { 'X-Mico-Whiteboard': token } : {}),
							},
							body: JSON.stringify({ messages: [] }),
						})
						assert.equal(chatRes.status, 403)
						assert.equal(
							((await chatRes.json()) as { error: string }).error,
							'WHITEBOARD_READ_ONLY',
						)

						const settingsPut = await fetch(`${baseUrl}/api/ai/settings`, {
							method: 'PUT',
							headers: {
								origin: DEV_ORIGIN,
								'Content-Type': 'application/json',
								...(token ? { 'X-Mico-Whiteboard': token } : {}),
							},
							body: JSON.stringify({
								baseURL: 'https://ai.example.invalid/v1',
								model: 'fixture-model-2',
							}),
						})
						assert.equal(settingsPut.status, 403)
					}

					const adaBlockedVoice = new WebSocket(
						`${wsUrl}/api/whiteboard-voice/mai/realtime?whiteboardSession=${ada.token}`,
						{ headers: { origin: DEV_ORIGIN } },
					)
					sockets.push(adaBlockedVoice)
					adaBlockedVoice.on('error', () => {})
					const [, blockedRes] = await once(adaBlockedVoice, 'unexpected-response', {
						signal: AbortSignal.timeout(4000),
					})
					assert.equal(blockedRes.statusCode, 403)
					blockedRes.resume()

					// Active presenter can update AI settings and open voice WS
					const jasonSettingsPut = await fetch(`${baseUrl}/api/ai/settings`, {
						method: 'PUT',
						headers: {
							origin: DEV_ORIGIN,
							'Content-Type': 'application/json',
							'X-Mico-Whiteboard': jason.token,
						},
						body: JSON.stringify({
							baseURL: 'https://ai.example.invalid/v1',
							model: 'fixture-model-2',
						}),
					})
					assert.equal(jasonSettingsPut.status, 200)

					const jasonVoice = new WebSocket(
						`${wsUrl}/api/whiteboard-voice/mai/realtime?whiteboardSession=${jason.token}`,
						{ headers: { origin: DEV_ORIGIN } },
					)
					sockets.push(jasonVoice)
					await once(jasonVoice, 'open', { signal: AbortSignal.timeout(4000) })

					// Request presenter -> cancel -> re-request -> decline
					const requested1 = nextPresence(
						jasonSocket,
						(event) =>
							event.type === 'presence' && Boolean(event.requesterIds?.includes(ada.member.id)),
					)
					adaSocket.send(JSON.stringify({ type: 'request-presenter', requested: true }))
					await requested1

					const cancelled = nextPresence(
						jasonSocket,
						(event) => event.type === 'presence' && (event.requesterIds?.length ?? 0) === 0,
					)
					adaSocket.send(JSON.stringify({ type: 'request-presenter', requested: false }))
					await cancelled

					const requested2 = nextPresence(
						jasonSocket,
						(event) =>
							event.type === 'presence' && Boolean(event.requesterIds?.includes(ada.member.id)),
					)
					adaSocket.send(JSON.stringify({ type: 'request-presenter', requested: true }))
					await requested2

					const declined = nextPresence(
						adaSocket,
						(event) =>
							event.type === 'presence' &&
							event.presenterId === jason.member.id &&
							(event.requesterIds?.length ?? 0) === 0,
					)
					jasonSocket.send(
						JSON.stringify({ type: 'decline-presenter', targetMemberId: ada.member.id }),
					)
					await declined

					// Approve / transfer presenter to Ada: closes Jason's voice WS and swaps AI access
					const requested3 = nextPresence(
						jasonSocket,
						(event) =>
							event.type === 'presence' && Boolean(event.requesterIds?.includes(ada.member.id)),
					)
					adaSocket.send(JSON.stringify({ type: 'request-presenter', requested: true }))
					await requested3

					const voiceClosed = once(jasonVoice, 'close', { signal: AbortSignal.timeout(4000) })
					const transferred = nextPresence(
						adaSocket,
						(event) =>
							event.type === 'presence' &&
							event.presenterId === ada.member.id &&
							(event.requesterIds?.length ?? 0) === 0,
					)
					jasonSocket.send(
						JSON.stringify({ type: 'transfer-presenter', targetMemberId: ada.member.id }),
					)
					const [, closed] = await Promise.all([transferred, voiceClosed])
					assert.equal(closed[0], 1008)

					for (const [token, status] of [
						[jason.token, 403],
						[ada.token, 200],
					] as const) {
						const response = await fetch(`${baseUrl}/api/canvases`, {
							method: 'POST',
							headers: {
								origin: DEV_ORIGIN,
								'Content-Type': 'application/json',
								'X-Mico-Whiteboard': token,
							},
							body: JSON.stringify({ name: 'After presenter transfer', activate: true }),
						})
						assert.equal(response.status, status)
					}

					const jasonNowBlocked = await fetch(`${baseUrl}/api/ai/settings`, {
						method: 'PUT',
						headers: {
							origin: DEV_ORIGIN,
							'Content-Type': 'application/json',
							'X-Mico-Whiteboard': jason.token,
						},
						body: JSON.stringify({
							baseURL: 'https://ai.example.invalid/v1',
							model: 'fixture-model-3',
						}),
					})
					assert.equal(jasonNowBlocked.status, 403)

					const adaNowAllowed = await fetch(`${baseUrl}/api/ai/settings`, {
						method: 'PUT',
						headers: {
							origin: DEV_ORIGIN,
							'Content-Type': 'application/json',
							'X-Mico-Whiteboard': ada.token,
						},
						body: JSON.stringify({
							baseURL: 'https://ai.example.invalid/v1',
							model: 'fixture-model-3',
						}),
					})
					assert.equal(adaNowAllowed.status, 200)

					// Direct transfer back without prior request
					const returned = nextPresence(
						jasonSocket,
						(event) => event.type === 'presence' && event.presenterId === jason.member.id,
					)
					adaSocket.send(
						JSON.stringify({ type: 'transfer-presenter', targetMemberId: jason.member.id }),
					)
					await returned
				} finally {
					for (const socket of sockets) socket.terminate()
				}
			},
			{
				createUpstream: () => new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`),
				env: {
					MICO_AI_ENABLED: 'true',
					MAGPIE_BASE_URL: 'https://ai.example.invalid/v1',
					MAGPIE_MODEL: 'fixture-model',
					MAGPIE_API_KEY: 'fixture-key',
					AZURE_MAI_HOST: 'voice.example',
					AZURE_OPENAI_API_KEY: 'test',
					AZURE_OPENAI_DEPLOYMENT: 'transcription',
				},
			},
		)
	} finally {
		for (const client of upstream.clients) client.terminate()
		await new Promise<void>((resolve) => upstream.close(() => resolve()))
	}
})
