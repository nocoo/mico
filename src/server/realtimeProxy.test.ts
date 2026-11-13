import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { connect as connectSocket } from 'node:net'
import type { Duplex } from 'node:stream'
import { test } from 'node:test'
import WebSocket, { WebSocketServer } from 'ws'
import { DEFAULT_MOSS_URL, loadAiConfig } from './aiConfig.ts'
import { createMaiProxy, MAI_LOCAL_PATH } from './maiProxy.ts'
import { createMossProxy, MOSS_LOCAL_PATH } from './mossProxy.ts'

const ALLOWED_ORIGIN = 'http://127.0.0.1:7063'
const ALLOWED_HOST = '127.0.0.1:7063'

type RealtimeProxy = {
	upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
	close(): void
}

async function listen(proxy: RealtimeProxy): Promise<{
	server: Server
	url: string
}> {
	const server = createServer()
	server.on('upgrade', proxy.upgrade)
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	return { server, url: `ws://127.0.0.1:${address.port}` }
}

async function stop(proxy: RealtimeProxy, server: Server): Promise<void> {
	proxy.close()
	await new Promise<void>((resolve) => server.close(() => resolve()))
}

function connect(url: string, path: string, origin = ALLOWED_ORIGIN): WebSocket {
	return new WebSocket(`${url}${path}`, {
		headers: { Host: ALLOWED_HOST, Origin: origin },
	})
}

async function expectRejectedUpgrade(url: string, path: string): Promise<void> {
	const client = connect(url, path, 'https://evil.example')
	await new Promise<void>((resolve, reject) => {
		client.once('open', () => reject(new Error('Upgrade unexpectedly succeeded')))
		client.once('error', () => resolve())
	})
}

test('realtime factories are reusable outside Vite and reject missing credentials', async () => {
	let maiUpstreamCalls = 0
	const mai = createMaiProxy({
		host: '',
		apiKey: '',
		deployment: '',
		createUpstream() {
			maiUpstreamCalls++
			throw new Error('not expected')
		},
	})
	let mossUpstreamCalls = 0
	const moss = createMossProxy({
		url: DEFAULT_MOSS_URL,
		apiKey: '',
		createUpstream() {
			mossUpstreamCalls++
			throw new Error('not expected')
		},
	})

	assert.equal(typeof mai.upgrade, 'function')
	assert.equal(typeof mai.close, 'function')
	assert.equal(typeof moss.upgrade, 'function')
	assert.equal(typeof moss.close, 'function')

	const maiServer = await listen(mai)
	const mossServer = await listen(moss)
	try {
		for (const [url, path, errorText] of [
			[maiServer.url, MAI_LOCAL_PATH, 'MAI credentials'],
			[mossServer.url, MOSS_LOCAL_PATH, 'MOSS_API_KEY'],
		] as const) {
			const client = connect(url, path)
			const message = once(client, 'message')
			const close = once(client, 'close')
			await once(client, 'open')
			const [frame] = await message
			assert.match(frame.toString(), new RegExp(errorText))
			const [code] = await close
			assert.equal(code, 1008)
		}
		assert.equal(maiUpstreamCalls, 0)
		assert.equal(mossUpstreamCalls, 0)
	} finally {
		await stop(mai, maiServer.server)
		await stop(moss, mossServer.server)
	}
})

test('realtime factories isolate malformed frames on missing-key and failed-upstream paths', {
	timeout: 5000,
}, async () => {
	for (const configured of [false, true]) {
		const fail = (): WebSocket => {
			throw new Error('Unavailable')
		}
		for (const [proxy, path] of [
			[
				createMaiProxy({
					host: 'mai.example',
					apiKey: configured ? 'test' : '',
					deployment: 'test',
					createUpstream: fail,
				}),
				MAI_LOCAL_PATH,
			],
			[
				createMossProxy({
					url: DEFAULT_MOSS_URL,
					apiKey: configured ? 'test' : '',
					createUpstream: fail,
				}),
				MOSS_LOCAL_PATH,
			],
		] as const) {
			const { server, url } = await listen(proxy)
			const socket = connectSocket(Number(new URL(url).port), '127.0.0.1')
			try {
				await once(socket, 'connect')
				const closed = once(socket, 'close')
				const key = Buffer.from('the sample nonce').toString('base64')
				socket.write(
					`GET ${path} HTTP/1.1\r\nHost: ${ALLOWED_HOST}\r\nOrigin: ${ALLOWED_ORIGIN}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
				)
				const [handshake] = await once(socket, 'data')
				assert.match(handshake.toString(), /101 Switching Protocols/)
				socket.write(Buffer.from([0x81, 0x01, 0x61]))
				socket.resume()
				await closed
				assert.equal(server.listening, true)
			} finally {
				socket.destroy()
				await stop(proxy, server)
			}
		}
	}
})

test('MAI forwards frames and safely closes on long Unicode upstream errors', {
	timeout: 5000,
}, async () => {
	const upstreamServer = new WebSocketServer({ host: '127.0.0.1', port: 0 })
	await once(upstreamServer, 'listening')
	const address = upstreamServer.address()
	assert.ok(address && typeof address !== 'string')
	let upstream: WebSocket | undefined
	const config = loadAiConfig({
		AZURE_MAI_HOST: 'mai.example',
		AZURE_OPENAI_API_KEY: 'test',
		AZURE_OPENAI_DEPLOYMENT: 'custom-transcription',
	})
	const proxy = createMaiProxy({
		...config.mai,
		createUpstream(url, options) {
			assert.equal(url, 'wss://mai.example/mai/v1/realtime?intent=transcription')
			assert.equal(options.headers['api-key'], 'test')
			upstream = new WebSocket(`ws://127.0.0.1:${address.port}`)
			return upstream
		},
	})
	const { server, url } = await listen(proxy)
	const connected = once(upstreamServer, 'connection')
	const client = connect(url, MAI_LOCAL_PATH)
	try {
		await once(client, 'open')
		const [peer] = await connected
		const forwarded = once(peer as WebSocket, 'message')
		client.send('audio')
		const [message] = await forwarded
		assert.equal(message.toString(), 'audio')
		const closed = once(client, 'close')
		assert.ok(upstream)
		upstream.emit('error', new Error('语音服务不可用'.repeat(100)))
		const [code, reason] = await closed
		assert.equal(code, 1011)
		assert.equal(reason.toString(), 'MAI upstream unavailable')
	} finally {
		client.terminate()
		await stop(proxy, server)
		for (const peer of upstreamServer.clients) peer.terminate()
		await new Promise<void>((resolve) => upstreamServer.close(() => resolve()))
	}
})

test('realtime factories reject foreign origins before creating upstreams', async () => {
	let upstreamCalls = 0
	const mai = createMaiProxy({
		host: 'mai.example',
		apiKey: 'secret',
		deployment: 'deployment',
		createUpstream() {
			upstreamCalls++
			throw new Error('not expected')
		},
	})
	const moss = createMossProxy({
		url: DEFAULT_MOSS_URL,
		apiKey: 'secret',
		createUpstream() {
			upstreamCalls++
			throw new Error('not expected')
		},
	})
	const maiServer = await listen(mai)
	const mossServer = await listen(moss)
	try {
		await expectRejectedUpgrade(maiServer.url, MAI_LOCAL_PATH)
		await expectRejectedUpgrade(mossServer.url, MOSS_LOCAL_PATH)
		assert.equal(upstreamCalls, 0)
	} finally {
		await stop(mai, maiServer.server)
		await stop(moss, mossServer.server)
	}
})

test('MOSS factory forwards frames with auth and terminates active sockets on close', async () => {
	class MockUpstream extends EventEmitter {
		readyState: number = WebSocket.CONNECTING
		bufferedAmount = 0
		readonly sent: [WebSocket.RawData, boolean][] = []
		readonly sentFrame: Promise<[WebSocket.RawData, boolean]>
		private resolveSent: (frame: [WebSocket.RawData, boolean]) => void = () => {}
		terminated = false

		constructor() {
			super()
			this.sentFrame = new Promise((resolve) => {
				this.resolveSent = resolve
			})
		}

		send(data: WebSocket.RawData, options: { binary: boolean }): void {
			const frame: [WebSocket.RawData, boolean] = [data, options.binary]
			this.sent.push(frame)
			this.resolveSent(frame)
		}

		close(): void {
			this.readyState = WebSocket.CLOSED
			this.emit('close', 1000, Buffer.alloc(0))
		}

		terminate(): void {
			this.terminated = true
			this.readyState = WebSocket.CLOSED
		}
	}

	let upstream: MockUpstream | undefined
	let authorization: string | undefined
	const config = loadAiConfig({
		MOSS_REALTIME_URL: 'wss://voice.example/custom?model=cloud-voice',
		MOSS_API_KEY: 'test-key',
	})
	const proxy = createMossProxy({
		...config.moss,
		createUpstream(url, options) {
			assert.equal(url, 'wss://voice.example/custom?model=cloud-voice')
			authorization = options.headers.Authorization
			upstream = new MockUpstream()
			queueMicrotask(() => {
				if (!upstream) return
				upstream.readyState = WebSocket.OPEN
				upstream.emit('open')
			})
			return upstream as unknown as WebSocket
		},
	})
	const { server, url } = await listen(proxy)
	const client = connect(url, MOSS_LOCAL_PATH)
	try {
		const ready = once(client, 'message')
		await once(client, 'open')
		const [readyFrame] = await ready
		assert.deepEqual(JSON.parse(readyFrame.toString()), { action: 'proxy.ready' })
		assert.equal(authorization, 'Bearer test-key')
		assert.ok(upstream)

		client.send(Buffer.from([1, 2, 3]), { binary: true })
		assert.deepEqual(await upstream.sentFrame, [Buffer.from([1, 2, 3]), true])

		const response = once(client, 'message')
		upstream.emit('message', Buffer.from('upstream'), false)
		const [responseFrame] = await response
		assert.equal(responseFrame.toString(), 'upstream')

		const clientClose = once(client, 'close')
		proxy.close()
		await clientClose
		assert.equal(upstream.terminated, true)
	} finally {
		if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
			client.terminate()
		}
		await stop(proxy, server)
	}
})
