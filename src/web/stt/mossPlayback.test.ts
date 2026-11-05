import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MossLivePlayback } from './mossPlayback.ts'

function setup() {
	const sources: Array<{
		buffer: AudioBuffer
		startTime: number
		stopCalls: number
		connect(): void
		start(time: number): void
		stop(): void
		disconnect(): void
		onended: (() => void) | null
	}> = []
	const context = {
		currentTime: 0,
		destination: {},
		createBuffer(_channels: number, length: number, rate: number) {
			return {
				duration: length / rate,
				getChannelData: () => new Float32Array(length),
			} as unknown as AudioBuffer
		},
		createBufferSource() {
			const source = {
				buffer: undefined as unknown as AudioBuffer,
				startTime: 0,
				stopCalls: 0,
				connect() {},
				start(time: number) {
					this.startTime = time
				},
				stop() {
					this.stopCalls++
					this.onended?.()
				},
				disconnect() {},
				onended: null as (() => void) | null,
			}
			sources.push(source)
			return source
		},
	}
	const sent: Record<string, unknown>[] = []
	const errors: string[] = []
	const player = new MossLivePlayback(
		context as unknown as ConstructorParameters<typeof MossLivePlayback>[0],
		(event) => sent.push(event),
		(message) => errors.push(message),
	)
	return { context, sources, sent, errors, player }
}

function pcm(length = 960): ArrayBuffer {
	const bytes = new ArrayBuffer(length * 2)
	const view = new DataView(bytes)
	for (let index = 0; index < length; index++)
		view.setInt16(index * 2, index % 2 ? 32767 : -32768, true)
	return bytes
}

const chunk = { run_id: 'r', turn_id: 't', chunk_id: 'c1' }

test('acknowledges a chunk only after playback and completes after done', () => {
	const { player, sources, sent } = setup()
	player.enqueue(chunk, pcm())
	player.enqueue({ ...chunk, chunk_id: 'c2' }, pcm())
	player.done(chunk)
	assert.equal(sources[1].startTime, 0.02)
	assert.deepEqual(sent, [])

	sources[0].onended?.()
	assert.deepEqual(
		sent.map((event: Record<string, unknown>) => event.action),
		['playback.chunk.completed'],
	)
	sources[1].onended?.()
	assert.deepEqual(
		sent.map((event: Record<string, unknown>) => event.action),
		['playback.chunk.completed', 'playback.chunk.completed', 'playback.completed'],
	)
})

test('interruption stops queued audio and does not complete the turn', () => {
	const { player, context, sent, sources } = setup()
	player.enqueue(chunk, pcm())
	player.enqueue({ ...chunk, chunk_id: 'c2' }, pcm())
	context.currentTime = 0.012
	player.stopAll()
	assert.equal(sources[0].stopCalls, 1)
	assert.equal(sources[1].stopCalls, 1)
	assert.deepEqual(sent, [
		{ action: 'playback.stopped', run_id: 'r', turn_id: 't', played_audio_ms: 12 },
	])
	player.done(chunk)
	assert.equal(sent.length, 1)
})

test('bounded playback rejects oversize and malformed PCM', () => {
	const { player, errors } = setup()
	player.enqueue(chunk, new ArrayBuffer(3))
	assert.deepEqual(errors, ['Received invalid 48 kHz PCM playback audio'])

	const oversized = new ArrayBuffer(4 * 1024 * 1024 + 2)
	player.enqueue(chunk, oversized)
	assert.deepEqual(errors.at(-1), 'Playback audio buffer limit exceeded')
})
