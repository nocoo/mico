import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	AudioHelperError,
	DEFAULT_AUDIO_HELPER_URL,
	openAudioHelperPermissions,
	openAudioHelperStream,
	probeAudioHelper,
	resolveAudioHelperBaseUrl,
} from './audioHelper.ts'

class FakeWebSocket extends EventTarget {
	static readonly CONNECTING = 0
	static readonly OPEN = 1
	static readonly CLOSING = 2
	static readonly CLOSED = 3

	readonly url: string
	binaryType = 'blob'
	readyState = FakeWebSocket.OPEN
	sent: string[] = []
	closed = false

	constructor(url: string) {
		super()
		this.url = url
		FakeWebSocket.last = this
	}

	static last: FakeWebSocket | null = null

	send(data: string): void {
		this.sent.push(data)
	}

	close(): void {
		this.closed = true
		this.readyState = FakeWebSocket.CLOSED
		this.dispatchEvent(new Event('close'))
	}

	emitMessage(data: unknown): void {
		this.dispatchEvent(new MessageEvent('message', { data }))
	}
}

test('resolveAudioHelperBaseUrl allows loopback overrides and rejects remote hosts', () => {
	const g = globalThis as { __MICO_AUDIO_HELPER_URL__?: string }
	const prev = g.__MICO_AUDIO_HELPER_URL__
	try {
		delete g.__MICO_AUDIO_HELPER_URL__
		assert.equal(resolveAudioHelperBaseUrl(), DEFAULT_AUDIO_HELPER_URL)

		g.__MICO_AUDIO_HELPER_URL__ = 'http://127.0.0.1:48001/extra'
		assert.equal(resolveAudioHelperBaseUrl(), 'http://127.0.0.1:48001')

		g.__MICO_AUDIO_HELPER_URL__ = 'https://evil.example.com'
		assert.equal(resolveAudioHelperBaseUrl(), DEFAULT_AUDIO_HELPER_URL)
	} finally {
		if (prev === undefined) delete g.__MICO_AUDIO_HELPER_URL__
		else g.__MICO_AUDIO_HELPER_URL__ = prev
	}
})

test('probeAudioHelper distinguishes ready, needs-permission, and unavailable', async () => {
	const ready = await probeAudioHelper({
		baseUrl: 'http://127.0.0.1:47065',
		fetchImpl: async () =>
			new Response(
				JSON.stringify({
					app: 'mico-helper',
					version: '0.1.0',
					platform: 'darwin',
					ready: true,
					capturing: false,
					permissions: { microphone: 'granted', systemAudio: 'granted' },
					activeDevice: 'MacBook Pro Microphone',
					sampleRate: 16000,
					channels: 1,
					encoding: 'pcm_s16le',
				}),
				{ status: 200 },
			),
	})
	assert.equal(ready.status, 'ready')
	assert.equal(ready.health?.activeDevice, 'MacBook Pro Microphone')

	const needsPerm = await probeAudioHelper({
		baseUrl: 'http://127.0.0.1:47065',
		fetchImpl: async () =>
			new Response(
				JSON.stringify({
					app: 'mico-helper',
					version: '0.1.0',
					platform: 'darwin',
					ready: false,
					capturing: false,
					permissions: { microphone: 'granted', systemAudio: 'denied' },
					activeDevice: 'MacBook Pro Microphone',
					sampleRate: 16000,
					channels: 1,
					encoding: 'pcm_s16le',
				}),
				{ status: 200 },
			),
	})
	assert.equal(needsPerm.status, 'needs-permission')

	const unavailable = await probeAudioHelper({
		baseUrl: 'http://127.0.0.1:47065',
		fetchImpl: async () => {
			throw new TypeError('connection refused')
		},
	})
	assert.equal(unavailable.status, 'unavailable')
	assert.equal(unavailable.health, null)
})

test('openAudioHelperPermissions posts to /open-permissions', async () => {
	let requestedUrl = ''
	let requestedMethod = ''
	const ok = await openAudioHelperPermissions({
		baseUrl: 'http://127.0.0.1:47065',
		fetchImpl: async (input, init) => {
			requestedUrl = String(input)
			requestedMethod = init?.method ?? ''
			return new Response(null, { status: 204 })
		},
	})
	assert.equal(ok, true)
	assert.equal(requestedUrl, 'http://127.0.0.1:47065/open-permissions')
	assert.equal(requestedMethod, 'POST')
})

test('openAudioHelperStream streams PCM16 frames and flushes cleanly on stop', async () => {
	const received: Int16Array[] = []
	let endedCalls = 0

	const pending = openAudioHelperStream(
		(pcm) => received.push(pcm),
		() => {
			endedCalls++
		},
		{
			baseUrl: 'http://127.0.0.1:47065',
			WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
		},
	)

	const ws = FakeWebSocket.last
	assert.ok(ws)
	assert.equal(ws.url, 'ws://127.0.0.1:47065/stream')
	ws.emitMessage(JSON.stringify({ type: 'started', sampleRate: 16000, channels: 1 }))

	const session = await pending
	const frame1 = Int16Array.from([120, -240, 360, -480])
	ws.emitMessage(frame1.buffer)
	assert.equal(received.length, 1)
	assert.deepEqual([...received[0]], [120, -240, 360, -480])

	const stopPromise = session.stop()
	assert.deepEqual(ws.sent, [JSON.stringify({ type: 'stop' })])

	const tail = Int16Array.from([42, -42])
	ws.emitMessage(tail.buffer)
	ws.emitMessage(JSON.stringify({ type: 'stopped' }))
	await stopPromise

	assert.equal(received.length, 2)
	assert.deepEqual([...received[1]], [42, -42])
	assert.equal(endedCalls, 0)
})

test('openAudioHelperStream surfaces permissions_required errors and remote menu bar stop', async () => {
	const deniedPending = openAudioHelperStream(
		() => {},
		() => {},
		{
			baseUrl: 'http://127.0.0.1:47065',
			WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
		},
	)
	const ws1 = FakeWebSocket.last
	assert.ok(ws1)
	ws1.emitMessage(
		JSON.stringify({
			type: 'error',
			code: 'permissions_required',
			message: 'Grant permissions in Mico Helper.',
		}),
	)
	await assert.rejects(deniedPending, (error: unknown) => {
		return error instanceof AudioHelperError && error.code === 'permissions_required'
	})

	let remoteEndedError: Error | undefined | null = null
	const activePending = openAudioHelperStream(
		() => {},
		(error) => {
			remoteEndedError = error
		},
		{
			baseUrl: 'http://127.0.0.1:47065',
			WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
		},
	)
	const ws2 = FakeWebSocket.last
	assert.ok(ws2)
	ws2.emitMessage(JSON.stringify({ type: 'started', sampleRate: 16000, channels: 1 }))
	await activePending

	ws2.emitMessage(JSON.stringify({ type: 'stopped' }))
	assert.equal(remoteEndedError, undefined)
})
