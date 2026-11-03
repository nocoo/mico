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
import { createDaemon } from './index.ts'

function getBoard(port: number, origin?: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path: '/api/board',
				headers: {
					host: '127.0.0.1:0',
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

test('invalid browser origins and malformed WebSocket frames are isolated', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-http-'))
	const daemon = createDaemon({ port: 0, dbPath: join(directory, 'board.sqlite') })
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening')
	const address = daemon.server.address()
	assert.ok(address && typeof address !== 'string')
	const port = address.port
	const good = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
		headers: { host: '127.0.0.1:0', origin: 'http://127.0.0.1:5173' },
	})
	try {
		await once(good, 'open')
		assert.equal(await getBoard(port, 'http://malicious.example'), 403)
		assert.equal(await getBoard(port, 'http://127.0.0.1:5173'), 200)
		const bad = connect(port, '127.0.0.1')
		await once(bad, 'connect')
		bad.write(
			'GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:0\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: http://127.0.0.1:5173\r\n\r\n',
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
				headers: { host: '127.0.0.1:0', origin: 'http://127.0.0.1:5173' },
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
