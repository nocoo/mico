import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import WebSocket from 'ws'
import manifest from '../../package.json' with { type: 'json' }
import { DEV_ORIGIN } from '../shared/config.ts'
import { createDaemon } from './index.ts'

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

test('HTTPS-origin subscribers receive API writes and reconnect to the latest board', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-live-'))
	const daemon = createDaemon({ port: 0, dbPath: join(directory, 'board.sqlite') })
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening')
	const address = daemon.server.address()
	assert.ok(address && typeof address !== 'string')
	const url = `http://127.0.0.1:${address.port}`
	const headers = { origin: DEV_ORIGIN }
	const socket = new WebSocket(`${url.replace('http:', 'ws:')}/api/events`, { headers })
	let reconnected: WebSocket | undefined
	try {
		const [initial] = await once(socket, 'message')
		assert.deepEqual(JSON.parse(initial.toString()), { revision: 0, shapes: [] })
		const live = await fetch(`${url}/api/live`, { headers })
		assert.equal(live.status, 200)
		assert.deepEqual(await live.json(), { status: 'ok', version: manifest.version })
		const wrongMethod = await fetch(`${url}/api/live`, { method: 'POST', headers })
		assert.equal(wrongMethod.status, 405)
		assert.equal(wrongMethod.headers.get('allow'), 'GET, OPTIONS')
		const preflight = await fetch(`${url}/api/live`, { method: 'OPTIONS', headers })
		assert.equal(preflight.status, 204)
		assert.equal(preflight.headers.get('access-control-allow-origin'), DEV_ORIGIN)
		const event = once(socket, 'message')
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
		assert.deepEqual(JSON.parse(message.toString()), board)
		socket.close()
		await once(socket, 'close')
		reconnected = new WebSocket(`${url.replace('http:', 'ws:')}/api/events`, { headers })
		const [snapshot] = await once(reconnected, 'message')
		assert.deepEqual(JSON.parse(snapshot.toString()), board)
	} finally {
		socket.terminate()
		reconnected?.terminate()
		daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('invalid browser origins and malformed WebSocket frames are isolated', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-http-'))
	const daemon = createDaemon({ port: 0, dbPath: join(directory, 'board.sqlite') })
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening')
	const address = daemon.server.address()
	assert.ok(address && typeof address !== 'string')
	const port = address.port
	const good = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
		headers: { origin: DEV_ORIGIN },
	})
	try {
		await once(good, 'open')
		assert.equal(await getBoard(port, 'http://malicious.example'), 403)
		assert.equal(await getBoard(port, DEV_ORIGIN), 200)
		assert.equal(await getBoard(port, 'https://other.dev.hexly.ai'), 403)
		assert.equal(await getBoard(port, 'https://mico.dev.hexly.ai.evil.example'), 403)
		const bad = connect(port, '127.0.0.1')
		await once(bad, 'connect')
		bad.write(
			`GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: https://mico.dev.hexly.ai\r\n\r\n`,
		)
		const [handshake] = await once(bad, 'data')
		assert.match(handshake.toString(), /101 Switching Protocols/)
		bad.write(Buffer.from([0x81, 0x01, 0x61]))
		await once(bad, 'close')
		assert.equal(await getBoard(port), 200)
		assert.equal(good.readyState, WebSocket.OPEN)

		const lock = new DatabaseSync(join(directory, 'board.sqlite'))
		const originalError = console.error
		try {
			lock.exec('BEGIN EXCLUSIVE')
			console.error = () => {}
			assert.equal(await getBoard(port), 500)
			const blocked = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
				headers: { origin: DEV_ORIGIN },
			})
			const [code] = await once(blocked, 'close')
			assert.equal(code, 1011)
		} finally {
			console.error = originalError
			lock.exec('ROLLBACK')
			lock.close()
		}
		assert.equal(await getBoard(port), 200)
	} finally {
		good.terminate()
		daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
})
