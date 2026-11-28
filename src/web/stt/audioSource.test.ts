import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadLecture, Player } from './audioSource.ts'

const originalFetch = globalThis.fetch
const originalOfflineAudioContext = globalThis.OfflineAudioContext

afterEach(() => {
	if (originalFetch === undefined) delete (globalThis as { fetch?: typeof fetch }).fetch
	else Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch })
	if (originalOfflineAudioContext === undefined) {
		delete (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
	} else {
		Object.defineProperty(globalThis, 'OfflineAudioContext', {
			configurable: true,
			value: originalOfflineAudioContext,
		})
	}
})

test('loadLecture decodes, resamples to 16kHz PCM16, computes peaks and checks HTTP status', async () => {
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async () => new Response('missing', { status: 404 }),
	})
	const ctx = {
		decodeAudioData: async () => ({ duration: 0.1 }),
	} as unknown as BaseAudioContext
	await assert.rejects(loadLecture(ctx, '/missing.mp3'), /HTTP 404/)

	const renderedChannel = new Float32Array([-1.5, -0.5, 0, 0.5, 1.5, 0.25])
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
	})
	Object.defineProperty(globalThis, 'OfflineAudioContext', {
		configurable: true,
		value: class {
			readonly destination = {}
			createBufferSource() {
				return {
					buffer: null,
					connect() {},
					start() {},
				}
			}
			async startRendering() {
				return {
					getChannelData: () => renderedChannel,
				}
			}
		},
	})

	const lecture = await loadLecture(ctx, '/lecture.mp3', 2)
	assert.equal(lecture.duration, 0.1)
	assert.deepEqual(Array.from(lecture.pcm), [-32768, -16384, 0, 16383, 32767, 8191])
	assert.equal(lecture.peaks.length, 4)
	assert.equal(lecture.peaks[0], -1)
	assert.ok(lecture.peaks[3] > 0.99)
})

test('Player tracks play, pause, rate, seekTo and reset state', () => {
	const starts: number[] = []
	let stops = 0
	const ctx = {
		currentTime: 0,
		destination: {},
		createBufferSource() {
			return {
				buffer: null,
				playbackRate: { value: 1 },
				connect() {},
				start(_when: number, offset: number) {
					starts.push(offset)
				},
				stop() {
					stops++
				},
				disconnect() {},
			}
		},
	} as unknown as BaseAudioContext & { currentTime: number }

	const player = new Player(ctx, {
		decoded: {} as AudioBuffer,
		pcm: new Int16Array(10),
		duration: 10,
		peaks: new Float32Array(4),
	})

	assert.equal(player.duration, 10)
	assert.equal(player.position, 0)
	player.pause()
	assert.equal(player.playing, false)

	player.play(2)
	assert.equal(player.playing, true)
	ctx.currentTime = 3
	assert.equal(player.position, 6)

	player.seekTo(4)
	assert.equal(player.playing, true)
	assert.deepEqual(starts, [0, 4])
	assert.equal(stops, 1)

	ctx.currentTime = 8
	assert.equal(player.position, 10) // clamped to duration

	player.pause()
	assert.equal(player.playing, false)
	assert.equal(player.position, 10)

	player.seekTo(-5)
	assert.equal(player.position, 0)
	player.seekTo(25)
	assert.equal(player.position, 10)

	player.reset()
	assert.equal(player.position, 0)
})
