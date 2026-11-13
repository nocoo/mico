import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import WebSocket from 'ws'
import { ALLOWED_ORIGINS } from '../shared/config.ts'
import { createDaemon, type Daemon } from './index.ts'
import { BoardStore } from './store.ts'

async function withProduction(
	run: (context: { url: string; directory: string; daemon: Daemon }) => Promise<void>,
): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-production-'))
	const staticDir = join(directory, 'dist')
	mkdirSync(join(staticDir, 'assets'), { recursive: true })
	writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Mico</title>')
	writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log("Mico")')
	writeFileSync(join(staticDir, 'lesson.mp3'), '0123456789')
	writeFileSync(join(directory, 'secret.txt'), 'private')
	writeFileSync(join(staticDir, '.env'), 'private')
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'settings.json'),
		staticDir,
		env: {},
	})
	let url = ''
	try {
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening')
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		url = `http://127.0.0.1:${address.port}`
		ALLOWED_ORIGINS.add(url)
		await run({ url, directory, daemon })
	} finally {
		ALLOWED_ORIGINS.delete(url)
		await daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

test('production serves built assets, conditional requests and audio ranges without exposing source', async () => {
	await withProduction(async ({ url }) => {
		const page = await fetch(url)
		assert.equal(page.status, 200)
		assert.match(page.headers.get('content-type') ?? '', /text\/html/)
		assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
		assert.match(await page.text(), /<title>Mico<\/title>/)
		const asset = await fetch(`${url}/assets/app.js`)
		assert.equal(asset.status, 200)
		assert.match(asset.headers.get('content-type') ?? '', /javascript/)
		await asset.text()
		assert.equal(
			(
				await fetch(`${url}/assets/app.js`, {
					headers: {
						'If-None-Match': asset.headers.get('etag') ?? '',
						'Cache-Control': 'max-age=0',
					},
				})
			).status,
			304,
		)
		const head = await fetch(`${url}/lesson.mp3`, { method: 'HEAD' })
		assert.equal(head.status, 200)
		assert.equal(head.headers.get('content-length'), '10')
		assert.equal(await head.text(), '')
		const range = await fetch(`${url}/lesson.mp3`, { headers: { Range: 'bytes=2-5' } })
		assert.equal(range.status, 206)
		assert.equal(range.headers.get('content-range'), 'bytes 2-5/10')
		assert.equal(await range.text(), '2345')
		for (const [rangeHeader, status, content] of [
			['bytes=0-0', 206, '0'],
			['bytes=-3', 206, '789'],
			['bytes=7-', 206, '789'],
			['bytes=7-100', 206, '789'],
			['bytes=8-3', 416, undefined],
			['bytes=999-', 416, undefined],
			['bytes=0-9007199254740992', 206, '0123456789'],
			['garbage', 200, '0123456789'],
		] as const) {
			const response = await fetch(`${url}/lesson.mp3`, { headers: { Range: rangeHeader } })
			assert.equal(response.status, status, rangeHeader)
			if (status === 416) assert.equal(response.headers.get('content-range'), 'bytes */10')
			const body = await response.text()
			if (content !== undefined) assert.equal(body, content)
		}
		assert.equal((await fetch(`${url}/api/live`)).status, 200)
		for (const path of [
			'/.env',
			'/secret.txt',
			'/%2e%2e%2fsecret.txt',
			'/src/server/index.ts',
			'/package.json',
			'/assets/missing.js',
			'/api/missing',
		]) {
			const response = await fetch(`${url}${path}`)
			assert.equal(response.status, 404, path)
			assert.doesNotMatch(await response.text(), /private|<title>/)
		}
		assert.equal((await fetch(url, { method: 'POST' })).status, 404)
		assert.equal((await fetch(url, { headers: { Origin: 'https://evil.example' } })).status, 403)
		const forbiddenHost = await new Promise<number>((resolve, reject) => {
			const req = request(url, { headers: { Host: 'evil.example' } }, (res) => {
				res.resume()
				res.on('end', () => resolve(res.statusCode ?? 0))
			})
			req.on('error', reject)
			req.end()
		})
		assert.equal(forbiddenHost, 403)
	})
})

test('production shares one origin for canvas API, events and provider routes', async () => {
	await withProduction(async ({ url }) => {
		const headers = { origin: url }
		const socket = new WebSocket(`${url.replace('http:', 'ws:')}/api/events`, { headers })
		try {
			const [initial] = await once(socket, 'message', { signal: AbortSignal.timeout(5000) })
			assert.equal(JSON.parse(initial.toString()).type, 'snapshot')
			const live = await fetch(`${url}/api/live`, { headers })
			assert.equal(live.status, 200)
			assert.equal((await live.json()).status, 'ok')
			const event = once(socket, 'message', { signal: AbortSignal.timeout(5000) })
			const created = await fetch(`${url}/api/canvases`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Production canvas', activate: true }),
			})
			assert.equal(created.status, 200)
			const state = await created.json()
			const [message] = await event
			assert.equal(JSON.parse(message.toString()).activeCanvasId, state.createdCanvasId)
			const config = await fetch(`${url}/mai/config`, { headers })
			assert.equal(config.status, 200)
			assert.deepEqual(await config.json(), {
				host: '',
				deployment: '',
				localPath: '/mai/realtime',
			})
			assert.equal((await fetch(`${url}/mai/config`, { method: 'POST', headers })).status, 405)
			for (const path of ['/moss', '/mai/realtime']) {
				const provider = new WebSocket(`${url.replace('http:', 'ws:')}${path}`, { headers })
				try {
					const closed = once(provider, 'close', { signal: AbortSignal.timeout(5000) })
					const [code] = await closed
					assert.equal(code, 1008, path)
				} finally {
					provider.terminate()
				}
			}
		} finally {
			socket.terminate()
		}
	})
})

test('SIGTERM drains an in-flight write before closing SQLite', { timeout: 10_000 }, async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-shutdown-'))
	const reservation = createServer()
	reservation.listen(0, '127.0.0.1')
	await once(reservation, 'listening')
	const address = reservation.address()
	assert.ok(address && typeof address !== 'string')
	await new Promise<void>((resolve) => reservation.close(() => resolve()))
	const dbPath = join(directory, 'board.sqlite')
	const child = spawn(process.execPath, ['src/server/index.ts'], {
		env: { HOME: directory, MICO_PORT: String(address.port), MICO_DB_PATH: dbPath },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	const exited = once(child, 'exit')
	try {
		const [ready] = await once(child.stdout, 'data')
		assert.match(ready.toString(), /MICO daemon listening/)
		const body = JSON.stringify({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'shutdown-note',
						type: 'note',
						x: 0,
						y: 0,
						w: 200,
						h: 160,
						color: '#ffffff',
						text: 'Saved before shutdown',
					},
				},
			],
		})
		const req = request(`http://127.0.0.1:${address.port}/api/operations`, {
			method: 'POST',
			headers: {
				Expect: '100-continue',
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(body),
				Connection: 'close',
			},
		})
		const response = once(req, 'response')
		req.flushHeaders()
		await once(req, 'continue')
		req.write(body.slice(0, 10))
		const stopping = once(child.stdout, 'data')
		child.kill('SIGTERM')
		const [message] = await stopping
		assert.match(message.toString(), /MICO daemon stopping/)
		req.end(body.slice(10))
		const [res] = await response
		res.resume()
		await once(res, 'end')
		assert.equal(res.statusCode, 200)
		const [code] = await exited
		assert.equal(code, 0)
		const store = new BoardStore(dbPath)
		try {
			assert.equal(store.getBoard().shapes[0].id, 'shutdown-note')
		} finally {
			store.close()
		}
	} finally {
		if (child.exitCode === null) child.kill('SIGKILL')
		await exited
		rmSync(directory, { recursive: true, force: true })
	}
})

test('production refuses a missing frontend build before opening a database', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-no-build-'))
	try {
		assert.throws(
			() => createDaemon({ staticDir: directory, dbPath: ':memory:', env: {} }),
			/ENOENT/,
		)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
