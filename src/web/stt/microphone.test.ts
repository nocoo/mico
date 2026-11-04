import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Pcm16Resampler, openMicrophone, resamplePcm16 } from './microphone.ts'

function closeTo(actual: number, expected: number, tolerance = 1): void {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)
}

test('PCM resampling preserves same-rate samples', () => {
	const input = new Float32Array([-1, -0.5, 0, 0.5, 1])
	const output = resamplePcm16(input, 16000)
	assert.equal(output.length, input.length)
	closeTo(output[0], -32768)
	closeTo(output[1], -16384)
	closeTo(output[2], 0)
	closeTo(output[3], 16384)
	closeTo(output[4], 32767)
})

function pushChunks(
	input: Float32Array,
	inputRate: number,
	chunkSizes: number[],
): Int16Array {
	const resampler = new Pcm16Resampler(inputRate, 16000)
	const chunks: Int16Array[] = []
	for (let offset = 0, chunk = 0; offset < input.length; chunk++) {
		const size = chunkSizes[chunk % chunkSizes.length]
		const end = Math.min(input.length, offset + size)
		chunks.push(resampler.push(input.subarray(offset, end)))
		offset = end
	}
	chunks.push(resampler.flush())

	const output = new Int16Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
	let offset = 0
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.length
	}
	return output
}

test('44100 Hz chunked resampling equals continuous single-input interpolation', () => {
	const input = new Float32Array(44100)
	for (let index = 0; index < input.length; index++) {
		input[index] = Math.sin((2 * Math.PI * 440 * index) / 44100) * 0.8
	}
	const single = resamplePcm16(input, 44100, 16000)
	const chunked = pushChunks(input, 44100, [127, 1024, 31, 2048])
	assert.equal(chunked.length, single.length)
	assert.deepEqual(chunked, single)
})

test('8000 Hz chunked resampling equals continuous single-input interpolation', () => {
	const input = new Float32Array([0, 0.25, -0.5, 1, -1, 0.75, -0.25, 0])
	const single = resamplePcm16(input, 8000, 16000)
	const chunked = pushChunks(input, 8000, [1, 3, 2])
	assert.equal(chunked.length, single.length)
	assert.deepEqual(chunked, single)
})

class MockTrack {
	readonly kind = 'audio'
	readyState: MediaStreamTrackState = 'live'
	stopCalls = 0
	private readonly listeners = new Map<string, Set<EventListener>>()

	addEventListener(type: string, listener: EventListener): void {
		const listeners = this.listeners.get(type) ?? new Set<EventListener>()
		listeners.add(listener)
		this.listeners.set(type, listeners)
	}

	removeEventListener(type: string, listener: EventListener): void {
		this.listeners.get(type)?.delete(listener)
	}

	stop(): void {
		this.stopCalls++
		this.readyState = 'ended'
	}

	dispatchEnded(): void {
		this.readyState = 'ended'
		for (const listener of this.listeners.get('ended') ?? []) listener(new Event('ended'))
	}
}

class MockWorkletPort {
	onmessage: ((event: { data: unknown }) => void) | null = null
	tailLength = 0
	flushMode: 'ack' | 'timeout' | 'error' = 'ack'

	postMessage(message: unknown): void {
		if (typeof message !== 'object' || message === null) return
		const data = message as { type?: string; id?: string }
		if (data.type !== 'flush') return
		if (this.flushMode === 'error') throw new Error('mock worklet delivery failure')
		if (this.flushMode === 'timeout') return
		queueMicrotask(() => {
			if (this.tailLength > 0) {
				const tail = new Float32Array(this.tailLength).fill(0.5)
				this.onmessage?.({
					data: { type: 'pcm', buffer: tail.buffer },
				})
			}
			this.onmessage?.({ data: { type: 'flushed', id: data.id } })
		})
	}
}

class MockWorkletNode {
	static instances: MockWorkletNode[] = []
	readonly port = new MockWorkletPort()
	onprocessorerror: (() => void) | null = null

	constructor() {
		MockWorkletNode.instances.push(this)
	}

	connect(): void {}
	disconnect(): void {}

	deliverPcm(length: number, value = 0.5): void {
		const pcm = new Float32Array(length).fill(value)
		this.port.onmessage?.({ data: { type: 'pcm', buffer: pcm.buffer } })
	}
}

class MockContext {
	readonly sampleRate = 48000
	readonly state = 'running'
	readonly destination = {}
	readonly audioWorklet: { addModule(): Promise<void> } | undefined
	closeCalls = 0

	constructor(workletSupported = true) {
		this.audioWorklet = workletSupported ? { addModule: async () => {} } : undefined
	}

	resume(): Promise<void> {
		return Promise.resolve()
	}

	createMediaStreamSource(): MediaStreamAudioSourceNode {
		return {
			connect: () => {},
			disconnect: () => {},
		} as unknown as MediaStreamAudioSourceNode
	}

	createGain(): GainNode {
		return {
			gain: { value: 1 },
			connect: () => {},
			disconnect: () => {},
		} as unknown as GainNode
	}

	addEventListener(): void {}
	removeEventListener(): void {}

	close(): Promise<void> {
		this.closeCalls++
		return Promise.resolve()
	}
}

function installCaptureMocks(track: MockTrack, context: MockContext): void {
	MockWorkletNode.instances = []
	const stream = {
		getAudioTracks: () => [track as unknown as MediaStreamTrack],
		getTracks: () => [track as unknown as MediaStreamTrack],
	} as unknown as MediaStream

	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			mediaDevices: {
				getUserMedia: async () => stream,
			},
		},
	})
	Object.defineProperty(globalThis, 'AudioContext', {
		configurable: true,
		value: class {
			constructor() {
				return context
			}
		},
	})
	Object.defineProperty(globalThis, 'AudioWorkletNode', {
		configurable: true,
		value: MockWorkletNode,
	})
}

function cleanupCaptureMocks(): void {
	delete (globalThis as { navigator?: Navigator }).navigator
	delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
	delete (globalThis as { AudioWorkletNode?: typeof AudioWorkletNode }).AudioWorkletNode
}

test('async stop flushes Worklet tail before resource cleanup', async () => {
	const track = new MockTrack()
	const context = new MockContext()
	installCaptureMocks(track, context)
	const worklet = MockWorkletNode.instances
	const delivered: Int16Array[] = []
	let ended = 0

	try {
		const capture = await openMicrophone((pcm) => delivered.push(pcm), () => ended++)
		const mockWorklet = MockWorkletNode.instances[0]
		mockWorklet.port.tailLength = 1023
		await capture.stop()

		assert.ok(delivered.length > 0)
		assert.equal(delivered.at(-1)?.length, 341)
		assert.equal(delivered.reduce((length, pcm) => length + pcm.length, 0), 341)
		assert.equal(track.stopCalls, 1)
		assert.equal(context.closeCalls, 1)
		assert.equal(ended, 0)
	} finally {
		cleanupCaptureMocks()
	}
})

test('track ended flushes Worklet tail before onEnded', async () => {
	const track = new MockTrack()
	const context = new MockContext()
	installCaptureMocks(track, context)
	const delivered: Int16Array[] = []
	let ended = 0
	let resolveEnded: (() => void) | null = null
	const endedPromise = new Promise<void>((resolve) => {
		resolveEnded = resolve
	})

	try {
		await openMicrophone(
			(pcm) => delivered.push(pcm),
			() => {
				ended++
				resolveEnded?.()
			},
		)
		const mockWorklet = MockWorkletNode.instances[0]
		mockWorklet.port.tailLength = 1023
		track.dispatchEnded()
		await endedPromise

		assert.ok(delivered.length > 0)
		assert.equal(delivered.at(-1)?.length, 341)
		assert.equal(delivered.reduce((length, pcm) => length + pcm.length, 0), 341)
		assert.equal(track.stopCalls, 1)
		assert.equal(context.closeCalls, 1)
		assert.equal(ended, 1)
	} finally {
		cleanupCaptureMocks()
	}
})

test('stop rejects after Worklet flush timeout and releases resources', async () => {
	const track = new MockTrack()
	const context = new MockContext()
	installCaptureMocks(track, context)
	let ended = 0

	try {
		const capture = await openMicrophone(() => {}, () => ended++)
		MockWorkletNode.instances[0].port.flushMode = 'timeout'

		await assert.rejects(capture.stop(), /Timed out waiting for microphone tail flush/)
		assert.equal(track.stopCalls, 1)
		assert.equal(context.closeCalls, 1)
		assert.equal(ended, 0)
	} finally {
		cleanupCaptureMocks()
	}
})

test('stop rejects after Worklet flush delivery error and releases resources', async () => {
	const track = new MockTrack()
	const context = new MockContext()
	installCaptureMocks(track, context)
	let ended = 0

	try {
		const capture = await openMicrophone(() => {}, () => ended++)
		MockWorkletNode.instances[0].port.flushMode = 'error'

		await assert.rejects(capture.stop(), /Could not request the microphone tail flush: mock worklet delivery failure/)
		assert.equal(track.stopCalls, 1)
		assert.equal(context.closeCalls, 1)
		assert.equal(ended, 0)
	} finally {
		cleanupCaptureMocks()
	}
})

test('capture emits 1600-sample frames and a final partial frame', async () => {
	const track = new MockTrack()
	const context = new MockContext()
	installCaptureMocks(track, context)
	const delivered: Int16Array[] = []

	try {
		const capture = await openMicrophone((pcm) => delivered.push(pcm), () => {})
		const mockWorklet = MockWorkletNode.instances[0]
		mockWorklet.port.tailLength = 0
		for (let index = 0; index < 5; index++) mockWorklet.deliverPcm(1024)
		await capture.stop()

		assert.equal(delivered.length, 2)
		assert.equal(delivered[0].length, 1600)
		assert.equal(delivered[1].length, 107)
		assert.equal(delivered.reduce((length, pcm) => length + pcm.length, 0), 1707)
	} finally {
		cleanupCaptureMocks()
	}
})

test('unsupported AudioWorklet rejects and releases the stream', async () => {
	const track = new MockTrack()
	const context = new MockContext(false)
	installCaptureMocks(track, context)

	try {
		await assert.rejects(openMicrophone(() => {}, () => {}), /AudioWorklet microphone capture is not supported/)
		assert.equal(track.stopCalls, 1)
		assert.equal(context.closeCalls, 1)
	} finally {
		cleanupCaptureMocks()
	}
})
