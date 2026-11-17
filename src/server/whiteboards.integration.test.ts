import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createServer } from 'vite'
import WebSocket, { WebSocketServer } from 'ws'
import { micoViteConfig } from '../../vite.config.ts'
import { DEV_ORIGIN } from '../shared/config.ts'
import type { Board, CanvasSnapshot, CanvasSummary, ServerEvent } from '../shared/types.ts'
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

async function fixture(
	run: (context: {
		url: string
		request: (
			path: string,
			method?: string,
			body?: unknown,
			session?: Pick<WhiteboardSession, 'token'>,
		) => Promise<Response>
		create: (name: string) => Promise<string>
		joinRoom: (
			id: string,
			sharer: boolean,
			username?: string,
			clientId?: string,
		) => Promise<WhiteboardSession>
	}) => Promise<void>,
	createVoiceUpstream?: () => WebSocket,
) {
	const directory = mkdtempSync(join(tmpdir(), 'mico-shared-'))
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'settings.json'),
		env: {},
		...(createVoiceUpstream
			? {
					createMaiUpstream: createVoiceUpstream,
					createMossUpstream: createVoiceUpstream,
					env: {
						MOSS_API_KEY: 'test',
						AZURE_MAI_HOST: 'voice.example',
						AZURE_OPENAI_API_KEY: 'test',
						AZURE_OPENAI_DEPLOYMENT: 'transcription',
					},
				}
			: {}),
	})

	try {
		await daemon.boards.waitUntilReady()
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening')
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		const url = `http://127.0.0.1:${address.port}`
		const request = (
			path: string,
			method = 'GET',
			body?: unknown,
			session?: Pick<WhiteboardSession, 'token'>,
		) =>
			fetch(`${url}${path}`, {
				method,
				headers: {
					origin: DEV_ORIGIN,
					'Content-Type': 'application/json',
					...(session ? { 'X-Mico-Whiteboard': session.token } : {}),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			})
		const create = async (name: string) => {
			const response = await request('/api/whiteboards', 'POST', { name })
			assert.equal(response.status, 201)
			return ((await response.json()) as { whiteboard: CanvasSummary }).whiteboard.id
		}
		const joinRoom = async (
			id: string,
			sharer: boolean,
			username = 'Jason Huang',
			clientId: string = randomUUID(),
		) => {
			const response = await request('/api/whiteboards/join', 'POST', {
				whiteboardid: id,
				username,
				sharer,
				clientId,
			})
			assert.equal(response.status, 200, await response.clone().text())
			return response.json() as Promise<WhiteboardSession>
		}
		await run({ url, request, create, joinRoom })
	} finally {
		await daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

test('shared voice aliases preserve origin checks through Vite and close when the presenter leaves', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-shared-voice-'))
	const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 })
	upstream.on('connection', (socket) => socket.on('message', (data) => socket.send(data)))
	await once(upstream, 'listening')
	const address = upstream.address()
	assert.ok(address && typeof address !== 'string')
	try {
		await fixture(
			async ({ url, create, joinRoom }) => {
				const base = micoViteConfig()
				const vite = await createServer({
					...base,
					configFile: false,
					cacheDir: join(directory, 'vite-cache'),
					server: {
						...base.server,
						port: 0,
						proxy: { '/api': { ...base.server.proxy['/api'], target: url } },
					},
				})
				try {
					await vite.listen()
					const address = vite.httpServer?.address()
					assert.ok(address && typeof address !== 'string')
					const voiceUrl = `ws://127.0.0.1:${address.port}`
					const id = await create('Voice room')
					const host = await joinRoom(id, true)
					const viewer = await joinRoom(id, false, 'Viewer')
					const main = subscribe(url, host)
					await main.next((event) => event.type === 'snapshot')
					const voices: WebSocket[] = []
					for (const path of ['/api/whiteboard-voice/mai/realtime', '/api/whiteboard-voice/moss']) {
						const blocked = new WebSocket(`${voiceUrl}${path}?whiteboardSession=${viewer.token}`, {
							headers: { origin: DEV_ORIGIN, host: new URL(DEV_ORIGIN).host },
						})
						blocked.on('error', () => {})
						const [, response] = await once(blocked, 'unexpected-response', {
							signal: AbortSignal.timeout(5000),
						})
						assert.equal(response.statusCode, 403)
						response.resume()
						blocked.terminate()
						const socket = new WebSocket(`${voiceUrl}${path}?whiteboardSession=${host.token}`, {
							headers: { origin: DEV_ORIGIN, host: new URL(DEV_ORIGIN).host },
						})
						voices.push(socket)
						const ready = path.endsWith('/moss')
							? once(socket, 'message', { signal: AbortSignal.timeout(5000) })
							: undefined
						await once(socket, 'open', { signal: AbortSignal.timeout(5000) })
						if (ready)
							assert.deepEqual(JSON.parse((await ready)[0].toString()), { action: 'proxy.ready' })
						const reply = once(socket, 'message', { signal: AbortSignal.timeout(5000) })
						socket.send('{"type":"probe"}')
						assert.equal((await reply)[0].toString(), '{"type":"probe"}')
					}
					const closed = voices.map((socket) =>
						once(socket, 'close', { signal: AbortSignal.timeout(5000) }),
					)
					main.socket.close()
					for (const outcome of await Promise.all(closed)) assert.equal(outcome[0], 1008)
				} finally {
					await vite.close()
				}
			},
			() => new WebSocket(`ws://127.0.0.1:${address.port}`),
		)
	} finally {
		for (const socket of upstream.clients) socket.terminate()
		await new Promise<void>((resolve) => upstream.close(() => resolve()))
		rmSync(directory, { recursive: true, force: true })
	}
})

test('shared boards list/create independently and enforce presenter-only room-scoped writes', async () => {
	await fixture(async ({ url, request, create, joinRoom }) => {
		const privateBefore = (await (await request('/api/state')).json()) as CanvasSnapshot
		const id = await create('Shared workshop')
		const otherId = await create('Other workshop')
		const list = (await (await request('/api/whiteboards')).json()) as {
			whiteboards: CanvasSummary[]
		}
		assert.ok(list.whiteboards.some((board) => board.id === id))
		assert.ok(!list.whiteboards.some((board) => board.id === privateBefore.activeCanvasId))
		assert.deepEqual(await (await request('/api/state')).json(), privateBefore)
		const presenter = await joinRoom(id, true)
		const participant = await joinRoom(id, false, 'Alice')
		const other = await joinRoom(otherId, false, 'Other room')
		const hostSocket = subscribe(url, presenter)
		const viewerSocket = subscribe(url, participant)
		const otherSocket = subscribe(url, other)
		const privateSocket = subscribe(url)
		await Promise.all(
			[hostSocket, viewerSocket, otherSocket, privateSocket].map((client) =>
				client.next((event) => event.type === 'snapshot'),
			),
		)
		const presence = await hostSocket.next(
			(event) => event.type === 'presence' && event.members.length === 2,
		)
		assert.ok(presence.type === 'presence')
		assert.equal(presence.presenterId, presenter.member.id)
		assert.deepEqual(presence.members.map((member) => member.username).sort(), [
			'Alice',
			'Jason Huang',
		])
		assert.equal(
			presence.members.find((member) => member.id === participant.member.id)?.color,
			participant.member.color,
		)
		const operation = {
			operations: [
				{
					type: 'create',
					shape: {
						id: 'shared-note',
						type: 'note',
						x: 10,
						y: 20,
						w: 160,
						h: 160,
						color: '#fef3c7',
						text: 'Together',
					},
				},
			],
		}
		for (const [path, method] of [
			['/api/operations', 'POST'],
			['/api/images', 'POST'],
			['/api/ai/chat', 'POST'],
			['/api/moss/session', 'POST'],
			['/api/moss/tool', 'POST'],
			['/api/ai/settings', 'PUT'],
			['/api/canvases', 'POST'],
			['/api/active-canvas', 'PUT'],
			['/api/whiteboards', 'POST'],
		])
			assert.equal((await request(path, method, operation, participant)).status, 403, path)
		assert.equal(
			(await request(`/api/canvases/${otherId}`, 'GET', undefined, presenter)).status,
			403,
		)
		assert.equal(
			(await request('/api/operations', 'POST', { ...operation, canvasId: otherId }, presenter))
				.status,
			403,
		)
		assert.equal((await request('/api/operations', 'POST', operation, presenter)).status, 200)
		const events = await Promise.all(
			[hostSocket, viewerSocket].map((client) => client.next((event) => event.type === 'board')),
		)
		for (const event of events) {
			assert.ok(event.type === 'board')
			assert.equal(event.canvasId, id)
			assert.equal(event.board.shapes[0].id, 'shared-note')
		}
		const snapshot = (await (
			await request('/api/state', 'GET', undefined, participant)
		).json()) as CanvasSnapshot
		assert.equal(snapshot.activeCanvasId, id)
		assert.deepEqual(
			snapshot.canvases.map((canvas) => canvas.id),
			[id],
		)
		assert.equal((await request(`/api/canvases/${id}`)).status, 404)
		assert.deepEqual(await (await request('/api/state')).json(), privateBefore)
		assert.equal(
			((await (await request('/api/board', 'GET', undefined, other)).json()) as Board).revision,
			0,
		)
		assert.ok(!otherSocket.events.some((event) => event.type === 'board'))
		assert.ok(!privateSocket.events.some((event) => event.type === 'board'))
		// A private snapshot must not reach a joined shared session.
		await request('/api/canvases', 'POST', { name: 'Private only', activate: true })
		await privateSocket.next((event) => event.type === 'snapshot')
		assert.ok(!viewerSocket.events.some((event) => event.type === 'snapshot'))
	})
})

test('presence, cursors and presenter view stay in one room, and presenter departure frees its slot', async () => {
	await fixture(async ({ url, request, create, joinRoom }) => {
		const id = await create('Live session')
		const clientId = randomUUID()
		const host = await joinRoom(id, true, 'Jason Huang', clientId)
		assert.deepEqual(await joinRoom(id, true, 'Jason Huang', clientId), host)
		for (const patch of [{ username: 'Renamed' }, { sharer: false }]) {
			const changed = await request('/api/whiteboards/join', 'POST', {
				whiteboardid: id,
				username: 'Jason Huang',
				sharer: true,
				clientId,
				...patch,
			})
			assert.equal(changed.status, 409, JSON.stringify(patch))
			assert.equal((await changed.json()).error, 'SESSION_CONFLICT')
		}
		const duplicate = await request('/api/whiteboards/join', 'POST', {
			whiteboardid: id,
			username: 'Second',
			sharer: true,
			clientId: randomUUID(),
		})
		assert.equal(duplicate.status, 409)
		const hostSocket = subscribe(url, host)
		const viewer = await joinRoom(id, false, 'Alice')
		const viewerSocket = subscribe(url, viewer)
		await viewerSocket.next((event) => event.type === 'presence' && event.members.length === 2)
		hostSocket.socket.send(
			JSON.stringify({
				type: 'presenter-view',
				viewport: { centerX: 200, centerY: -30, zoom: 1.4 },
			}),
		)
		const view = await viewerSocket.next((event) => event.type === 'presenter-view')
		assert.deepEqual(view, {
			type: 'presenter-view',
			viewport: { centerX: 200, centerY: -30, zoom: 1.4 },
		})
		viewerSocket.socket.send(JSON.stringify({ type: 'cursor', point: { x: 50, y: 60 } }))
		assert.deepEqual(await hostSocket.next((event) => event.type === 'cursor'), {
			type: 'cursor',
			memberId: viewer.member.id,
			point: { x: 50, y: 60 },
		})
		const late = subscribe(url, await joinRoom(id, false, 'Late'))
		const state = await late.next((event) => event.type === 'presence')
		assert.ok(state.type === 'presence')
		assert.deepEqual(state.viewport, { centerX: 200, centerY: -30, zoom: 1.4 })
		hostSocket.socket.close()
		await viewerSocket.next((event) => event.type === 'presence' && event.presenterId === null)
		assert.equal((await request('/api/operations', 'POST', { operations: [] }, host)).status, 403)
		const replacement = await joinRoom(id, true, 'Replacement')
		const replacementSocket = subscribe(url, replacement)
		await replacementSocket.next((event) => event.type === 'snapshot')
		assert.equal(
			(
				await request('/api/whiteboards/join', 'POST', {
					whiteboardid: id,
					username: 'Jason Huang',
					sharer: true,
					clientId,
				})
			).status,
			409,
		)
		const closed = once(viewerSocket.socket, 'close')
		viewerSocket.socket.send(
			JSON.stringify({ type: 'presenter-view', viewport: { centerX: 0, centerY: 0, zoom: 1 } }),
		)
		const [code] = await closed
		assert.equal(code, 1008)
	})
})

test('invalid joins fail and simultaneous presenter claims admit only one', async () => {
	await fixture(async ({ request, create }) => {
		const id = await create('Race')
		const valid = { whiteboardid: id, username: 'Host', sharer: true, clientId: randomUUID() }
		for (const patch of [
			{ username: '' },
			{ username: 'x'.repeat(81) },
			{ sharer: 'true' },
			{ clientId: 'not-a-uuid' },
		])
			assert.equal(
				(await request('/api/whiteboards/join', 'POST', { ...valid, ...patch })).status,
				400,
			)
		assert.equal(
			(await request('/api/whiteboards/join', 'POST', { ...valid, whiteboardid: 'missing' }))
				.status,
			404,
		)
		const outcomes = await Promise.all(
			[valid, { ...valid, clientId: randomUUID() }].map((body) =>
				request('/api/whiteboards/join', 'POST', body),
			),
		)
		assert.deepEqual(outcomes.map((response) => response.status).sort(), [200, 409])
		assert.equal((await request('/api/state', 'GET', undefined, { token: 'missing' })).status, 401)
	})
})

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
	input: { username: string; sharer: boolean; clientId: string },
) {
	return fetch(`${baseUrl}/api/whiteboards/join`, {
		method: 'POST',
		headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
		body: JSON.stringify({ whiteboardid: 'demo', ...input }),
	})
}

test('demo members share canvas management and active-canvas snapshots', async () => {
	await withDemoServer(async ({ baseUrl }) => {
		const joined = await joinDemo(baseUrl, {
			username: 'Guest',
			sharer: false,
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
