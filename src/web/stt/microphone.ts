export const TARGET_MICROPHONE_RATE = 16000
export const MICROPHONE_FRAME_SAMPLES = 320

function floatToPcm16(sample: number): number {
	const clamped = Math.max(-1, Math.min(1, sample))
	return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
}

export function resamplePcm16(
	input: Float32Array,
	inputRate: number,
	outputRate = TARGET_MICROPHONE_RATE,
): Int16Array {
	if (!Number.isFinite(inputRate) || inputRate <= 0) throw new Error('Invalid input sample rate')
	if (!Number.isFinite(outputRate) || outputRate <= 0) throw new Error('Invalid output sample rate')
	if (input.length === 0) return new Int16Array()

	const ratio = inputRate / outputRate
	const length = Math.ceil(input.length / ratio)
	const output = new Int16Array(length)
	for (let index = 0, position = 0; position < input.length; index++, position += ratio) {
		const leftIndex = Math.floor(position)
		const fraction = position - leftIndex
		const left = input[leftIndex]
		const right = leftIndex + 1 < input.length ? input[leftIndex + 1] : left
		output[index] = floatToPcm16(left + (right - left) * fraction)
	}
	return output
}

export class Pcm16Resampler {
	private readonly ratio: number
	private position = 0
	private previous: number | null = null

	constructor(inputRate: number, outputRate = TARGET_MICROPHONE_RATE) {
		if (!Number.isFinite(inputRate) || inputRate <= 0) throw new Error('Invalid input sample rate')
		if (!Number.isFinite(outputRate) || outputRate <= 0) {
			throw new Error('Invalid output sample rate')
		}
		this.ratio = inputRate / outputRate
	}

	push(input: Float32Array): Int16Array {
		if (input.length === 0) return new Int16Array()

		const output: number[] = []
		let deferred = false
		while (this.position < input.length) {
			const leftIndex = Math.floor(this.position)
			const fraction = this.position - leftIndex
			if (leftIndex === input.length - 1 && fraction > 0) {
				deferred = true
				break
			}

			let left = input[leftIndex]
			if (leftIndex === 0 && fraction > 0 && this.position < 1 && this.previous !== null) {
				left = this.previous
			}
			const right = leftIndex + 1 < input.length ? input[leftIndex + 1] : left
			output.push(floatToPcm16(left + (right - left) * fraction))
			this.position += this.ratio
		}

		if (deferred) this.position -= Math.floor(this.position)
		else if (this.position >= input.length) this.position -= input.length
		this.previous = input[input.length - 1]
		return Int16Array.from(output)
	}
}

const WORKLET_SOURCE = `
class MicoMicrophoneProcessor extends AudioWorkletProcessor {
	constructor() {
		super()
		this.samples = new Float32Array(1024)
		this.offset = 0
	}
	process(inputs, outputs) {
		const input = inputs[0]?.[0]
		if (input?.length) {
			let sourceOffset = 0
			while (sourceOffset < input.length) {
				const count = Math.min(input.length - sourceOffset, this.samples.length - this.offset)
				this.samples.set(input.subarray(sourceOffset, sourceOffset + count), this.offset)
				sourceOffset += count
				this.offset += count
				if (this.offset === this.samples.length) {
					const copy = this.samples.slice()
					this.port.postMessage(copy.buffer, [copy.buffer])
					this.offset = 0
				}
			}
		}
		const output = outputs[0]
		if (output?.length && input?.length) {
			for (let channel = 0; channel < output.length; channel++) {
				output[channel].set(input)
			}
		}
		return true
	}
}
registerProcessor('mico-microphone', MicoMicrophoneProcessor)
`

export async function openMicrophone(
	onPcm: (pcm: Int16Array) => void,
	onEnded: () => void,
): Promise<{ stop(): void }> {
	const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
	if (!mediaDevices?.getUserMedia) throw new Error('Microphone capture is not supported')

	const stream = await mediaDevices.getUserMedia({
		video: false,
		audio: { channelCount: { ideal: 1 } },
	})

	const tracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : stream.getTracks()
	let context: AudioContext | null = null
	let source: MediaStreamAudioSourceNode | null = null
	let worklet: AudioWorkletNode | null = null
	let processor: ScriptProcessorNode | null = null
	let gain: GainNode | null = null
	let stopped = false
	let ended = false
	let pcmCarry = new Int16Array()
	const trackListeners = new Map<MediaStreamTrack, () => void>()
	let contextStateListener: (() => void) | null = null

	const flushPcmCarry = () => {
		if (pcmCarry.length === 0) return
		const partial = pcmCarry
		pcmCarry = new Int16Array()
		onPcm(partial)
	}

	const cleanupResources = () => {
		for (const [track, listener] of trackListeners) {
			track.removeEventListener('ended', listener)
		}
		trackListeners.clear()
		if (context && contextStateListener) {
			context.removeEventListener('statechange', contextStateListener)
			contextStateListener = null
		}
		try {
			source?.disconnect()
			worklet?.disconnect()
			processor?.disconnect()
			gain?.disconnect()
		} catch {}
		source = null
		worklet = null
		processor = null
		gain = null
		for (const track of tracks) {
			try {
				track.stop()
			} catch {}
		}
		if (context) {
			const closing = context
			context = null
			try {
				const closeResult = closing.close()
				void Promise.resolve(closeResult).catch(() => {})
			} catch {}
		}
	}

	const unexpectedEnd = () => {
		if (stopped || ended) return
		ended = true
		try {
			flushPcmCarry()
		} finally {
			cleanupResources()
			onEnded()
		}
	}

	const stop = () => {
		if (stopped || ended) return
		stopped = true
		try {
			flushPcmCarry()
		} finally {
			cleanupResources()
		}
	}

	for (const track of tracks) {
		const listener = () => unexpectedEnd()
		trackListeners.set(track, listener)
		track.addEventListener('ended', listener)
		if (track.readyState === 'ended') listener()
	}

	try {
		const AudioContextConstructor = globalThis.AudioContext
		if (!AudioContextConstructor) throw new Error('Web Audio is not supported')

		try {
			context = new AudioContextConstructor({ sampleRate: TARGET_MICROPHONE_RATE })
		} catch {
			context = new AudioContextConstructor()
		}

		if (context.state === 'suspended') {
			await context.resume()
		}
		if (stopped || ended) throw new Error('Microphone capture ended')

		contextStateListener = () => {
			if (context?.state === 'closed') unexpectedEnd()
		}
		context.addEventListener('statechange', contextStateListener)

		source = context.createMediaStreamSource(stream)
		const resampler = new Pcm16Resampler(context.sampleRate || 48000)
		const inputQueue: Float32Array[] = []
		const appendPcm = (pcm: Int16Array) => {
			const combined = new Int16Array(pcmCarry.length + pcm.length)
			combined.set(pcmCarry)
			combined.set(pcm, pcmCarry.length)
			pcmCarry = combined
			while (pcmCarry.length >= MICROPHONE_FRAME_SAMPLES) {
				const frame = pcmCarry.slice(0, MICROPHONE_FRAME_SAMPLES)
				pcmCarry = pcmCarry.slice(MICROPHONE_FRAME_SAMPLES)
				onPcm(frame)
			}
		}
		const drainInput = (input: Float32Array) => {
			if (inputQueue.length >= 32) inputQueue.shift()
			inputQueue.push(input)
			while (inputQueue.length > 0) {
				const queued = inputQueue.shift()
				if (queued) appendPcm(resampler.push(queued))
			}
		}

		let workletSetup = false
		const WorkletConstructor = (
			globalThis as typeof globalThis & {
				AudioWorkletNode?: typeof AudioWorkletNode
			}
		).AudioWorkletNode
		if (context.audioWorklet && WorkletConstructor && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
			let moduleUrl: string | null = null
			try {
				const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
				moduleUrl = URL.createObjectURL(blob)
				await context.audioWorklet.addModule(moduleUrl)
				worklet = new WorkletConstructor(context, 'mico-microphone', {
					numberOfInputs: 1,
					numberOfOutputs: 1,
					outputChannelCount: [1],
				})
				worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
					if (stopped || ended) return
					if (event.data instanceof ArrayBuffer) {
						drainInput(new Float32Array(event.data))
					}
				}
				worklet.onprocessorerror = () => unexpectedEnd()
				source.connect(worklet)
				workletSetup = true
			} catch {}
			finally {
				if (moduleUrl) URL.revokeObjectURL(moduleUrl)
			}
		}

		if (!workletSetup) {
			if (typeof context.createScriptProcessor !== 'function') {
				throw new Error('No supported Web Audio capture processor')
			}
			processor = context.createScriptProcessor(2048, 1, 1)
			processor.onaudioprocess = (event) => {
				if (stopped || ended) return
				drainInput(event.inputBuffer.getChannelData(0).slice())
			}
			source.connect(processor)
		}

		gain = context.createGain()
		gain.gain.value = 0
		gain.connect(context.destination)
		if (worklet) worklet.connect(gain)
		else if (processor) processor.connect(gain)

		if (stopped || ended) throw new Error('Microphone capture ended')
		return { stop }
	} catch (error) {
		stopped = true
		cleanupResources()
		throw error
	}
}
