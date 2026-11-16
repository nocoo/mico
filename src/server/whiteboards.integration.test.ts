import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import WebSocket from 'ws'
import { DEV_ORIGIN } from '../shared/config.ts'
import type { PresenceEvent, WhiteboardSession } from '../shared/whiteboards.ts'
import { createDaemon } from './index.ts'

async function withDemoServer(run: (context: { baseUrl: string; wsUrl: string }) => Promise<void>) {
	const directory = mkdtempSync(join(tmpdir(), 'mico-demo-presence-'))
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'settings.json'),
		env: {
			MICO_AUTH_MODE: 'demo',
			MICO_AI_ENABLED: 'false',
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
