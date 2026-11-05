import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import WebSocket from 'ws'
import manifest from '../../package.json' with { type: 'json' }
import { DEV_ORIGIN } from '../shared/config.ts'
import type { Board, ServerEvent } from '../shared/types.ts'
import { fetchAiModels } from './ai.ts'
import { createDaemon, type Daemon } from './index.ts'

const WAIT_MS = 5000

function getBoard(port: number, origin?: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path: '/api/board',
				headers: {
					...(origin ? { origin } : {}),
				},
			},
			(res) => {
				res.resume()
				res.on('end', () => resolve(res.statusCode ?? 0))
			},
		)
		req.on('error', reject)
		req.end()
	})
}

interface LiveContext {
	daemon: Daemon
	directory: string
	port: number
	url: string
}

async function withLiveDaemon(run: (context: LiveContext) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-live-'))
	let daemon: Daemon | undefined
	try {
		daemon = createDaemon({
			port: 0,
			dbPath: join(directory, 'board.sqlite'),
			settingsPath: join(directory, 'ai-settings', 'settings.json'),
		})
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		await run({
			daemon,
			directory,
			port: address.port,
			url: `http://127.0.0.1:${address.port}`,
		})
	} finally {
		if (daemon) {
			for (const client of daemon.wss.clients) client.terminate()
			daemon.close()
		}
		rmSync(directory, { recursive: true, force: true })
	}
}

test('HTTPS-origin subscribers receive API writes and reconnect to the latest board', async () => {
	await withLiveDaemon(async ({ url }) => {
		const headers = { origin: DEV_ORIGIN }
		const socket = new WebSocket(`${url.replace('http:', 'ws:')}/api/events`, { headers })
		let reconnected: WebSocket | undefined
		try {
			const [initial] = await once(socket, 'message', { signal: AbortSignal.timeout(WAIT_MS) })
			const initialEvent = JSON.parse(initial.toString()) as ServerEvent
			assert.equal(initialEvent.type, 'snapshot')
			assert.deepEqual(initialEvent.board, { revision: 0, shapes: [] })
			const live = await fetch(`${url}/api/live`, { headers })
			assert.equal(live.status, 200)
			assert.deepEqual(await live.json(), { status: 'ok', version: manifest.version })
			const wrongMethod = await fetch(`${url}/api/live`, { method: 'POST', headers })
			assert.equal(wrongMethod.status, 405)
			assert.equal(wrongMethod.headers.get('allow'), 'GET, OPTIONS')
			const preflight = await fetch(`${url}/api/live`, { method: 'OPTIONS', headers })
			assert.equal(preflight.status, 204)
			assert.equal(preflight.headers.get('access-control-allow-origin'), DEV_ORIGIN)
			const event = once(socket, 'message', { signal: AbortSignal.timeout(WAIT_MS) })
			const response = await fetch(`${url}/api/operations`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					expectedRevision: 0,
					operations: [
						{
							type: 'create',
							shape: {
								id: 'live-node',
								type: 'rectangle',
								x: 100,
								y: 100,
								w: 200,
								h: 80,
								color: '#5b5fc7',
								text: 'Live API update',
							},
						},
					],
				}),
			})
			assert.equal(response.status, 200)
			const board = await response.json()
			const [message] = await event
			const boardEvent = JSON.parse(message.toString()) as ServerEvent
			assert.equal(boardEvent.type, 'board')
			assert.deepEqual(boardEvent.board, board)
			socket.close()
			await once(socket, 'close', { signal: AbortSignal.timeout(WAIT_MS) })
			reconnected = new WebSocket(`${url.replace('http:', 'ws:')}/api/events`, { headers })
			const [snapshot] = await once(reconnected, 'message', {
				signal: AbortSignal.timeout(WAIT_MS),
			})
			const snapshotEvent = JSON.parse(snapshot.toString()) as ServerEvent
			assert.equal(snapshotEvent.type, 'snapshot')
			assert.deepEqual(snapshotEvent.board, board)
		} finally {
			socket.terminate()
			reconnected?.terminate()
		}
	})
})

test('AI settings expose only public fields and preserve the existing key contract', async () => {
	await withLiveDaemon(async ({ url, port, directory }) => {
		const headers = { origin: DEV_ORIGIN }
		const get = await fetch(`${url}/api/ai/settings`, { headers })
		assert.equal(get.status, 200)
		assert.deepEqual(await get.json(), {
			baseURL: 'http://127.0.0.1:3425/v1',
			model: 'auto/gpt-6-luna',
			hasApiKey: true,
		})

		const secret = 'test-api-secret'
		const put = await fetch(`${url}/api/ai/settings`, {
			method: 'PUT',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify({
				baseURL: 'https://example.test/v1/',
				model: 'group/test',
				apiKey: secret,
			}),
		})
		assert.equal(put.status, 200)
		const publicSettings = await put.json()
		assert.deepEqual(publicSettings, {
			baseURL: 'https://example.test/v1',
			model: 'group/test',
			hasApiKey: true,
		})
		assert.equal(JSON.stringify(publicSettings).includes(secret), false)

		const settingsPath = join(directory, 'ai-settings', 'settings.json')
		assert.equal(statSync(settingsPath).mode & 0o777, 0o600)
		assert.equal(statSync(join(directory, 'ai-settings')).mode & 0o777, 0o700)
		const saved = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
		assert.equal(saved.apiKey, secret)

		const preserve = await fetch(`${url}/api/ai/settings`, {
			method: 'PUT',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify({ baseURL: 'https://example.test/v2/', model: 'group/test-2' }),
		})
		assert.equal(preserve.status, 200)
		assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')).apiKey, secret)

		const clear = await fetch(`${url}/api/ai/settings`, {
			method: 'PUT',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify({
				baseURL: 'https://example.test/v2',
				model: 'group/test-2',
				apiKey: '',
			}),
		})
		assert.equal(clear.status, 200)
		assert.deepEqual(await clear.json(), {
			baseURL: 'https://example.test/v2',
			model: 'group/test-2',
			hasApiKey: false,
		})

		const invalid = await fetch(`${url}/api/ai/settings`, {
			method: 'PUT',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify({ baseURL: 'relative', model: 'group/test' }),
		})
		assert.equal(invalid.status, 400)

		const wrongOrigin = await fetch(`${url}/api/ai/settings`, {
			headers: { origin: 'http://malicious.example' },
		})
		assert.equal(wrongOrigin.status, 403)

		const blockedHost = await new Promise<number>((resolve, reject) => {
			const req = request(
				{
					host: '127.0.0.1',
					port,
					path: '/api/ai/settings',
					headers: { host: 'evil.example', origin: DEV_ORIGIN },
				},
				(res) => {
					res.resume()
					res.on('end', () => resolve(res.statusCode ?? 0))
				},
			)
			req.on('error', reject)
			req.end()
		})
		assert.equal(blockedHost, 403)
	})
})

test('AI models use the saved effective gateway, preserve prefixes, and hide credentials', async () => {
	const observed: Array<{ path: string | undefined; authorization: string | undefined }> = []
	const mock = createServer((req, res) => {
		observed.push({ path: req.url, authorization: req.headers.authorization })
		if (req.url === '/redirect/models') {
			res.writeHead(302, { Location: '/leak/models' })
			res.end()
			return
		}
		if (req.url === '/slow/models') {
			setTimeout(() => {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ data: [{ id: 'too-late' }] }))
			}, 100)
			return
		}
		if (req.url === '/error/models') {
			res.writeHead(503, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ error: 'upstream-secret-and-details' }))
			return
		}
		if (req.url === '/bad/models') {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ data: 'not-an-array' }))
			return
		}
		if (req.url === '/empty/models') {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ data: [] }))
			return
		}
		if (req.url === '/leak/models') {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ data: [{ id: 'credential-leaked' }] }))
			return
		}
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ data: [{ id: 'model-one' }, { id: 'model-two' }] }))
	})

	mock.listen(0, '127.0.0.1')
	await once(mock, 'listening', { signal: AbortSignal.timeout(WAIT_MS) })
	const mockAddress = mock.address()
	assert.ok(mockAddress && typeof mockAddress !== 'string')
	const mockBaseURL = `http://127.0.0.1:${mockAddress.port}`

	try {
		await withLiveDaemon(async ({ url, port }) => {
			const headers = { origin: DEV_ORIGIN }

			const firstPut = await fetch(`${url}/api/ai/settings`, {
				method: 'PUT',
				headers: { ...headers, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					baseURL: `${mockBaseURL}/v1/`,
					model: 'model-one',
					apiKey: 'server-secret-one',
				}),
			})
			assert.equal(firstPut.status, 200)

			const firstGet = await fetch(`${url}/api/ai/models`, { headers })
			assert.equal(firstGet.status, 200)
			assert.deepEqual(await firstGet.json(), { models: ['model-one', 'model-two'] })
			assert.deepEqual(observed.at(-1), {
				path: '/v1/models',
				authorization: 'Bearer server-secret-one',
			})

			const secondPut = await fetch(`${url}/api/ai/settings`, {
				method: 'PUT',
				headers: { ...headers, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					baseURL: `${mockBaseURL}/v2`,
					model: 'model-two',
					apiKey: 'server-secret-two',
				}),
			})
			assert.equal(secondPut.status, 200)
			const secondGet = await fetch(`${url}/api/ai/models`, { headers })
			assert.equal(secondGet.status, 200)
			assert.deepEqual(observed.at(-1), {
				path: '/v2/models',
				authorization: 'Bearer server-secret-two',
			})

			await fetch(`${url}/api/ai/settings`, {
				method: 'PUT',
				headers: { ...headers, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					baseURL: `${mockBaseURL}/v2`,
					model: 'model-two',
					apiKey: '',
				}),
			})
			await fetch(`${url}/api/ai/models`, { headers })
			assert.equal(observed.at(-1)?.authorization, undefined)

			const emptyPut = await fetch(`${url}/api/ai/settings`, {
				method: 'PUT',
				headers: { ...headers, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					baseURL: `${mockBaseURL}/empty`,
					model: 'empty',
					apiKey: '',
				}),
			})
			assert.equal(emptyPut.status, 200)
			const emptyGet = await fetch(`${url}/api/ai/models`, { headers })
			assert.equal(emptyGet.status, 200)
			assert.deepEqual(await emptyGet.json(), { models: [] })

			for (const suffix of ['bad', 'error']) {
				await fetch(`${url}/api/ai/settings`, {
					method: 'PUT',
					headers: { ...headers, 'Content-Type': 'application/json' },
					body: JSON.stringify({
						baseURL: `${mockBaseURL}/${suffix}`,
						model: 'error',
						apiKey: 'browser-must-not-see',
					}),
				})
				const failed = await fetch(`${url}/api/ai/models`, { headers })
				assert.equal(failed.status, 502)
				const failedBody = await failed.json()
				assert.deepEqual(failedBody, {
					error: 'AI_MODELS_UNAVAILABLE',
					message: 'Could not fetch AI models',
				})
				assert.equal(JSON.stringify(failedBody).includes('browser-must-not-see'), false)
				assert.equal(JSON.stringify(failedBody).includes('upstream-secret'), false)
			}

			await fetch(`${url}/api/ai/settings`, {
				method: 'PUT',
				headers: { ...headers, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					baseURL: `${mockBaseURL}/redirect`,
					model: 'redirect',
					apiKey: 'redirect-secret',
				}),
			})
			const redirect = await fetch(`${url}/api/ai/models`, { headers })
			assert.equal(redirect.status, 502)
			assert.equal(
				observed.some((entry) => entry.path === '/leak/models'),
				false,
			)

			const preflight = await fetch(`${url}/api/ai/models`, { method: 'OPTIONS', headers })
			assert.equal(preflight.status, 204)
			assert.equal(preflight.headers.get('access-control-allow-origin'), DEV_ORIGIN)
			const wrongMethod = await fetch(`${url}/api/ai/models`, { method: 'POST', headers })
			assert.equal(wrongMethod.status, 405)
			assert.equal(wrongMethod.headers.get('allow'), 'GET, OPTIONS')
			const wrongOrigin = await fetch(`${url}/api/ai/models`, {
				headers: { origin: 'http://malicious.example' },
			})
			assert.equal(wrongOrigin.status, 403)

			const blockedHost = await new Promise<number>((resolve, reject) => {
				const req = request(
					{
						host: '127.0.0.1',
						port,
						path: '/api/ai/models',
						headers: { host: 'evil.example', origin: DEV_ORIGIN },
					},
					(res) => {
						res.resume()
						res.on('end', () => resolve(res.statusCode ?? 0))
					},
				)
				req.on('error', reject)
				req.end()
			})
			assert.equal(blockedHost, 403)
		})

		await assert.rejects(
			fetchAiModels(
				{ baseURL: `${mockBaseURL}/slow`, apiKey: 'timeout-secret', model: 'slow' },
				20,
			),
			(error: unknown) =>
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				(error as { code: string }).code === 'AI_MODELS_UNAVAILABLE',
		)
	} finally {
		await new Promise<void>((resolve) => mock.close(() => resolve()))
	}
})

test('invalid browser origins and malformed WebSocket frames are isolated', async () => {
	await withLiveDaemon(async ({ directory, port }) => {
		const good = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
			headers: { origin: DEV_ORIGIN },
		})
		let bad: ReturnType<typeof connect> | undefined
		let blocked: WebSocket | undefined
		try {
			await once(good, 'open', { signal: AbortSignal.timeout(WAIT_MS) })
			assert.equal(await getBoard(port, 'http://malicious.example'), 403)
			assert.equal(await getBoard(port, DEV_ORIGIN), 200)
			assert.equal(await getBoard(port, 'https://other.dev.hexly.ai'), 403)
			assert.equal(await getBoard(port, 'https://mico.dev.hexly.ai.evil.example'), 403)
			bad = connect(port, '127.0.0.1')
			await once(bad, 'connect', { signal: AbortSignal.timeout(WAIT_MS) })
			bad.write(
				`GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: https://mico.dev.hexly.ai\r\n\r\n`,
			)
			const [handshake] = await once(bad, 'data', { signal: AbortSignal.timeout(WAIT_MS) })
			assert.match(handshake.toString(), /101 Switching Protocols/)
			bad.write(Buffer.from([0x81, 0x01, 0x61]))
			await once(bad, 'close', { signal: AbortSignal.timeout(WAIT_MS) })
			assert.equal(await getBoard(port), 200)
			assert.equal(good.readyState, WebSocket.OPEN)

			const lock = new DatabaseSync(join(directory, 'board.sqlite'))
			const originalError = console.error
			try {
				lock.exec('BEGIN EXCLUSIVE')
				console.error = () => {}
				assert.equal(await getBoard(port), 500)
				blocked = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
					headers: { origin: DEV_ORIGIN },
				})
				blocked.on('error', () => {})
				const [code] = await once(blocked, 'close', { signal: AbortSignal.timeout(WAIT_MS) })
				assert.equal(code, 1011)
			} finally {
				console.error = originalError
				lock.exec('ROLLBACK')
				lock.close()
				blocked?.terminate()
			}
			assert.equal(await getBoard(port), 200)
		} finally {
			good.terminate()
			bad?.destroy()
		}
	})
})

interface LiveSocket {
	socket: WebSocket
	next(label?: string): Promise<ServerEvent>
}

function liveSocket(url: string): LiveSocket {
	const socket = new WebSocket(url, { headers: { origin: DEV_ORIGIN } })
	return {
		socket,
		next: (label = 'board') =>
			new Promise<ServerEvent>((resolve, reject) => {
				const timer = setTimeout(() => {
					cleanup()
					reject(new Error(`timed out waiting for ${label}`))
				}, WAIT_MS)
				const onMessage = (data: WebSocket.RawData) => {
					cleanup()
					resolve(JSON.parse(data.toString()) as ServerEvent)
				}
				const onError = (error: Error) => {
					cleanup()
					reject(error)
				}
				const cleanup = () => {
					clearTimeout(timer)
					socket.off('message', onMessage)
					socket.off('error', onError)
				}
				socket.on('message', onMessage)
				socket.on('error', onError)
			}),
	}
}

async function expectRejectedSocket(url: string, origin: string): Promise<void> {
	const socket = new WebSocket(url, { headers: { origin } })
	socket.on('error', () => {
		// The aborted handshake may emit after the rejection has been observed.
	})
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				cleanup()
				reject(new Error('timed out waiting for the WebSocket rejection'))
			}, WAIT_MS)
			const onOpen = () => {
				cleanup()
				reject(new Error('foreign origin was accepted'))
			}
			const onResponse = (_request: unknown, response: { statusCode?: number }) => {
				cleanup()
				try {
					assert.equal(response.statusCode, 403)
					resolve()
				} catch (error) {
					reject(error)
				}
			}
			const onError = (error: Error) => {
				cleanup()
				reject(error)
			}
			const cleanup = () => {
				clearTimeout(timer)
				socket.off('open', onOpen)
				socket.off('unexpected-response', onResponse)
				socket.off('error', onError)
			}
			socket.on('open', onOpen)
			socket.on('unexpected-response', onResponse)
			socket.on('error', onError)
		})
	} finally {
		try {
			socket.terminate()
		} catch {
			// The rejected handshake leaves nothing to terminate.
		}
	}
}

test('WebSocket rejects foreign origins and broadcasts create, update and delete', async () => {
	await withLiveDaemon(async ({ url }) => {
		const wsUrl = `${url.replace('http:', 'ws:')}/api/events`
		await expectRejectedSocket(wsUrl, 'https://evil.example')

		const first = liveSocket(wsUrl)
		const second = liveSocket(wsUrl)
		try {
			const initialFirst = first.next('initial-1')
			const initialSecond = second.next('initial-2')
			for (const event of [await initialFirst, await initialSecond]) {
				assert.equal(event.type, 'snapshot')
				assert.deepEqual(event.board, { revision: 0, shapes: [] })
			}

			const createFirst = first.next('create-1')
			const createSecond = second.next('create-2')
			const created = await fetch(`${url}/api/operations`, {
				method: 'POST',
				headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					operations: [
						{
							type: 'create',
							shape: {
								id: 'ws-note',
								type: 'note',
								x: 10,
								y: 10,
								w: 80,
								h: 80,
								color: '#fef3c7',
								text: 'Live',
							},
						},
					],
				}),
			})
			assert.equal(created.status, 200)
			const afterCreate = (await created.json()) as Board
			for (const event of [await createFirst, await createSecond]) {
				assert.equal(event.type, 'board')
				assert.deepEqual(event.board, afterCreate)
			}

			const updateFirst = first.next('update-1')
			const updateSecond = second.next('update-2')
			const updated = await fetch(`${url}/api/operations`, {
				method: 'POST',
				headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					operations: [{ type: 'update', id: 'ws-note', patch: { text: 'Updated' } }],
				}),
			})
			assert.equal(updated.status, 200)
			const afterUpdate = (await updated.json()) as Board
			for (const event of [await updateFirst, await updateSecond]) {
				assert.equal(event.type, 'board')
				assert.deepEqual(event.board, afterUpdate)
			}

			const counts = { first: 0, second: 0 }
			const countFirst = () => {
				counts.first += 1
			}
			const countSecond = () => {
				counts.second += 1
			}
			first.socket.on('message', countFirst)
			second.socket.on('message', countSecond)
			const conflict = await fetch(`${url}/api/operations`, {
				method: 'POST',
				headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					expectedRevision: 0,
					operations: [{ type: 'update', id: 'ws-note', patch: { text: 'Stale' } }],
				}),
			})
			assert.equal(conflict.status, 409)

			const barrierFirst = first.next('barrier-1')
			const barrierSecond = second.next('barrier-2')
			const barrier = await fetch(`${url}/api/operations`, {
				method: 'POST',
				headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					operations: [{ type: 'update', id: 'ws-note', patch: { text: 'Barrier' } }],
				}),
			})
			assert.equal(barrier.status, 200)
			const barrierBoard = (await barrier.json()) as Board
			for (const event of [await barrierFirst, await barrierSecond]) {
				assert.equal(event.type, 'board')
				assert.deepEqual(event.board, barrierBoard)
			}
			first.socket.off('message', countFirst)
			second.socket.off('message', countSecond)
			assert.deepEqual(counts, { first: 1, second: 1 })

			const deleteFirst = first.next('delete-1')
			const deleteSecond = second.next('delete-2')
			const deleted = await fetch(`${url}/api/operations`, {
				method: 'POST',
				headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
				body: JSON.stringify({ operations: [{ type: 'delete', id: 'ws-note' }] }),
			})
			assert.equal(deleted.status, 200)
			const afterDelete = (await deleted.json()) as Board
			for (const event of [await deleteFirst, await deleteSecond]) {
				assert.equal(event.type, 'board')
				assert.deepEqual(event.board, afterDelete)
			}

			const createCanvasFirst = first.next('canvas-create-1')
			const createCanvasSecond = second.next('canvas-create-2')
			const createdCanvas = await fetch(`${url}/api/canvases`, {
				method: 'POST',
				headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Live canvas', activate: true }),
			})
			assert.equal(createdCanvas.status, 200)
			const createdCanvasState = (await createdCanvas.json()) as {
				activeCanvasId: string
				createdCanvasId: string
				canvases: unknown[]
				board: Board
			}
			assert.equal(createdCanvasState.activeCanvasId, createdCanvasState.createdCanvasId)
			assert.equal(createdCanvasState.canvases.length, 2)
			assert.deepEqual(createdCanvasState.board, { revision: 0, shapes: [] })
			for (const event of [await createCanvasFirst, await createCanvasSecond]) {
				assert.equal(event.type, 'snapshot')
				assert.equal(event.activeCanvasId, createdCanvasState.createdCanvasId)
				assert.equal(event.canvases.length, 2)
			}

			const activateFirst = first.next('canvas-activate-1')
			const activateSecond = second.next('canvas-activate-2')
			const activated = await fetch(`${url}/api/active-canvas`, {
				method: 'PUT',
				headers: { origin: DEV_ORIGIN, 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: 'main' }),
			})
			assert.equal(activated.status, 200)
			const activatedState = (await activated.json()) as { activeCanvasId: string; board: Board }
			assert.equal(activatedState.activeCanvasId, 'main')
			for (const event of [await activateFirst, await activateSecond]) {
				assert.equal(event.type, 'snapshot')
				assert.equal(event.activeCanvasId, 'main')
				assert.deepEqual(event.board, activatedState.board)
			}
		} finally {
			first.socket.terminate()
			second.socket.terminate()
		}
	})
})
