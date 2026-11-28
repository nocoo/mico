import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
	MaiClient,
	maiEmptyAudioBufferError,
	maiErrorCode,
	maiErrorMessage,
	maiEventItemId,
	maiEventRequestId,
} from './maiClient.ts'

test('MAI nested provider error exposes the exact message and code', () => {
	const event = {
		type: 'invalid_request_error',
		code: 'input_audio_buffer_commit_empty',
		message: 'Input audio buffer is empty.',
	}
	assert.equal(maiErrorCode(event), 'input_audio_buffer_commit_empty')
	assert.equal(maiErrorMessage(event), 'Input audio buffer is empty.')
	assert.equal(maiEmptyAudioBufferError(event), true)
})

test('MAI nested error shape remains distinguishable from the generic fallback', () => {
	const event = {
		error: {
			code: 'server_error',
			message: 'The transcription provider rejected the audio.',
		},
	}
	assert.equal(maiErrorCode(event), 'server_error')
	assert.equal(maiErrorMessage(event), 'The transcription provider rejected the audio.')
	assert.equal(maiEmptyAudioBufferError(event), false)
})

test('MAI item_id identifies acknowledged transcription items', () => {
	assert.equal(
		maiEventItemId({
			type: 'input_audio_buffer.committed',
			event_id: 'event_server_ack',
			item_id: 'item_first',
		}),
		'item_first',
	)
	assert.equal(maiEventItemId({ event_id: 'event_server_only' }), null)
})

test('MAI request event_id is preserved for correlated terminal errors', () => {
	assert.equal(
		maiEventRequestId({
			event_id: 'commit-1-2',
			error: { code: 'input_audio_buffer_commit_empty' },
		}),
		'commit-1-2',
	)
	assert.equal(
		maiEventRequestId({
			error: { event_id: 'commit-1-1', code: 'input_audio_buffer_commit_empty' },
		}),
		'commit-1-1',
	)
	assert.equal(maiEventRequestId({ error: { code: 'input_audio_buffer_commit_empty' } }), null)
})

test('MAI code-only and unknown errors never hide provider failure', () => {
	assert.equal(
		maiErrorMessage({ code: 'model_overloaded' }),
		'Transcription provider error: model_overloaded',
	)
	assert.equal(maiErrorMessage({}), 'Transcription provider failed.')
	assert.equal(maiEmptyAudioBufferError({ message: 'Input audio buffer is empty.' }), true)
})

class MockMaiSocket {
	static readonly OPEN = 1
	static instances: MockMaiSocket[] = []
	readonly sent: string[] = []
	readonly url: string
	readyState = MockMaiSocket.OPEN
	onopen: (() => void) | null = null
	onmessage: ((event: { data: string }) => void) | null = null
	onerror: (() => void) | null = null
	onclose: ((event: { code: number; reason: string }) => void) | null = null
	closedWith: { code?: number; reason?: string } | null = null

	constructor(url: string) {
		this.url = url
		MockMaiSocket.instances.push(this)
	}

	send(data: string): void {
		this.sent.push(data)
	}

	close(code?: number, reason?: string): void {
		this.closedWith = { code, reason }
		this.readyState = 3
	}
}

const originalWebSocket = globalThis.WebSocket
const originalLocation = globalThis.location
const originalWindow = globalThis.window

afterEach(() => {
	MockMaiSocket.instances = []
	if (originalWebSocket === undefined)
		delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
	else
		Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket })
	if (originalLocation === undefined) delete (globalThis as { location?: Location }).location
	else
		Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation })
	if (originalWindow === undefined) delete (globalThis as { window?: Window }).window
	else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

test('MaiClient opens session, routes transcription events, sends PCM chunks and closes cleanly', async () => {
	Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockMaiSocket })
	Object.defineProperty(globalThis, 'location', {
		configurable: true,
		value: { protocol: 'https:', host: 'mico.example' },
	})
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			location: { search: '' },
			setTimeout: globalThis.setTimeout,
			clearTimeout: globalThis.clearTimeout,
		},
	})

	const client = new MaiClient({
		path: '/mai/realtime',
		model: 'gpt-4o-transcribe',
		language: 'en',
	})
	const seen: Array<{ type: string; payload: unknown }> = []
	for (const kind of [
		'open',
		'created',
		'delta',
		'intermediate',
		'completed',
		'committed',
		'error',
		'closed',
	]) {
		client.on(kind, (payload) => seen.push({ type: kind, payload }))
	}

	const openPromise = client.open()
	const ws = MockMaiSocket.instances[0]
	assert.ok(ws.url.startsWith('wss://mico.example/mai/realtime?intent=transcription'))

	ws.onopen?.()
	const configure = JSON.parse(ws.sent[0]) as {
		type: string
		session: { audio: { input: { transcription: { language?: string } } } }
	}
	assert.equal(configure.type, 'session.update')
	assert.equal(configure.session.audio.input.transcription.language, 'en')

	ws.onmessage?.({ data: 'not-json' })
	ws.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) })
	ws.onmessage?.({
		data: JSON.stringify({
			type: 'conversation.item.input_audio_transcription.delta',
			delta: 'he',
		}),
	})
	ws.onmessage?.({
		data: JSON.stringify({
			type: 'conversation.item.input_audio_transcription.intermediate',
			text: 'hel',
		}),
	})
	ws.onmessage?.({
		data: JSON.stringify({
			type: 'conversation.item.input_audio_transcription.completed',
			transcript: 'hello',
		}),
	})
	ws.onmessage?.({
		data: JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'item-1' }),
	})
	ws.onmessage?.({ data: JSON.stringify({ type: 'response.failed', error: { code: 'bad' } }) })
	ws.onmessage?.({ data: JSON.stringify({ type: 'session.updated' }) })
	await openPromise

	const pcm = new Int16Array([0x0102, 0x0304, 0x0506])
	client.append(pcm, 1, 3)
	const appended = JSON.parse(ws.sent[1]) as { type: string; audio: string }
	assert.equal(appended.type, 'input_audio_buffer.append')
	assert.equal(Buffer.from(appended.audio, 'base64').length, 4)

	client.commit('c-1')
	assert.deepEqual(JSON.parse(ws.sent[2]), { type: 'input_audio_buffer.commit', event_id: 'c-1' })

	client.close()
	assert.deepEqual(ws.closedWith, { code: 1000, reason: 'done' })
	assert.deepEqual(
		seen.map((entry) => entry.type),
		['open', 'created', 'delta', 'intermediate', 'completed', 'committed', 'error'],
	)

	const failClient = new MaiClient({ path: '/mai/realtime', model: 'gpt-4o-transcribe' })
	const failPromise = failClient.open()
	MockMaiSocket.instances[1].onclose?.({ code: 1006, reason: 'lost' })
	await assert.rejects(failPromise, /Connection closed 1006 lost/)
})
