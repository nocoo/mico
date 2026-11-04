import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	Pcm16Resampler,
	openMicrophone,
	resamplePcm16,
} from './microphone.ts'

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

test('PCM resampling downsamples continuously across chunks', () => {
	const resampler = new Pcm16Resampler(48000, 16000)
	const first = resampler.push(new Float32Array([0, 1, 0, 1]))
	const second = resampler.push(new Float32Array([0, 1, 0, 1]))
	assert.equal(first.length, 2)
	assert.equal(second.length, 1)
	closeTo(first[0], 0)
})

test('PCM resampling upsample edge values is linear and bounded', () => {
	const input = new Float32Array([0, 1])
	const output = resamplePcm16(input, 8000, 16000)
	assert.equal(output.length, 4)
	closeTo(output[0], 0)
	closeTo(output[1], 16384)
	closeTo(output[2], 32767)
	closeTo(output[3], 32767)
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

class MockProcessor {
	onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null

	connect(): void {}
	disconnect(): void {}
}

class MockContext {
	readonly sampleRate = 48000
	readonly state = 'running'
	readonly destination = {}
	readonly processor = new MockProcessor()
	readonly audioWorklet = undefined
	closeCalls = 0

	resume(): Promise<void> {
		return Promise.resolve()
	}

	createMediaStreamSource(): MediaStreamAudioSourceNode {
		return {
			connect: () => {},
			disconnect: () => {},
		} as unknown as MediaStreamAudioSourceNode
	}

	createScriptProcessor(): ScriptProcessorNode {
		return this.processor as unknown as ScriptProcessorNode
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
}

function processMockPcm(context: MockContext, length = 1024): void {
	context.processor.onaudioprocess?.({
		inputBuffer: {
			getChannelData: () => new Float32Array(length).fill(0.5),
		},
	} as unknown as AudioProcessingEvent)
}

test('intentional stop synchronously flushes the partial PCM tail', async () => {
	const track = new MockTrack()
	const context = new MockContext()
	installCaptureMocks(track, context)
	const delivered: Int16Array[] = []
	let ended = 0

	const capture = await openMicrophone((pcm) => delivered.push(pcm), () => ended++)
	processMockPcm(context)
	capture.stop()

	assert.ok(delivered.length > 0)
	assert.equal(delivered.at(-1)?.length, 22)
	assert.equal(delivered.reduce((length, pcm) => length + pcm.length, 0), 342)
	assert.equal(track.stopCalls, 1)
	assert.equal(context.closeCalls, 1)
	assert.equal(ended, 0)

	delete (globalThis as { navigator?: Navigator }).navigator
	delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
})

test('track ended flushes the tail before onEnded', async () => {
	const track = new MockTrack()
	const context = new MockContext()
	installCaptureMocks(track, context)
	const delivered: Int16Array[] = []
	let ended = 0

	const capture = await openMicrophone((pcm) => delivered.push(pcm), () => ended++)
	processMockPcm(context)
	track.dispatchEnded()

	assert.ok(delivered.length > 0)
	assert.equal(delivered.at(-1)?.length, 22)
	assert.equal(delivered.reduce((length, pcm) => length + pcm.length, 0), 342)
	assert.equal(track.stopCalls, 1)
	assert.equal(context.closeCalls, 1)
	assert.equal(ended, 1)

	capture.stop()
	assert.equal(ended, 1)

	delete (globalThis as { navigator?: Navigator }).navigator
	delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
})
