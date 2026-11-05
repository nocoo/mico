export const TARGET_MICROPHONE_RATE = 16000
export const MICROPHONE_FRAME_SAMPLES = 1600

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
	const samples: number[] = []
	for (let position = 0; position < input.length; position += ratio) {
		const leftIndex = Math.floor(position)
		const fraction = position - leftIndex
		const left = input[leftIndex]
		const right = leftIndex + 1 < input.length ? input[leftIndex + 1] : left
		samples.push(floatToPcm16(left + (right - left) * fraction))
	}
	return Int16Array.from(samples)
}

export class Pcm16Resampler {
	private readonly ratio: number
	private position = 0
	private consumed = 0
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

		const start = this.consumed
		const end = start + input.length
		const output: number[] = []
		while (this.position < end) {
			const leftIndex = Math.floor(this.position)
			const fraction = this.position - leftIndex
			let left: number
			let right: number

			if (leftIndex < start) {
				if (leftIndex !== start - 1 || this.previous === null) break
				left = this.previous
				right = input[0]
			} else if (leftIndex < end - 1) {
				const localIndex = leftIndex - start
				left = input[localIndex]
				right = input[localIndex + 1]
			} else if (leftIndex === end - 1) {
				const localIndex = leftIndex - start
				left = input[localIndex]
				if (fraction > 0) break
				right = left
			} else {
				break
			}

			output.push(floatToPcm16(left + (right - left) * fraction))
			this.position += this.ratio
		}

		this.consumed = end
		this.previous = input[input.length - 1]
		return Int16Array.from(output)
	}

	flush(): Int16Array {
		if (this.previous === null) return new Int16Array()

		const output: number[] = []
		while (this.position < this.consumed) {
			const leftIndex = Math.floor(this.position)
			if (leftIndex === this.consumed - 1) {
				output.push(floatToPcm16(this.previous))
				this.position += this.ratio
				continue
			}
			break
		}
		return Int16Array.from(output)
	}
}

const WORKLET_SOURCE = `
class MicoMicrophoneProcessor extends AudioWorkletProcessor {
	constructor() {
		super()
		this.samples = new Float32Array(1024)
		this.offset = 0
		this.port.onmessage = (event) => {
			if (event.data?.type !== 'flush') return
			if (this.offset > 0) {
				const copy = this.samples.slice(0, this.offset)
				this.port.postMessage({ type: 'pcm', buffer: copy.buffer }, [copy.buffer])
				this.offset = 0
			}
			this.port.postMessage({ type: 'flushed', id: event.data.id })
		}
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
					this.port.postMessage({ type: 'pcm', buffer: copy.buffer }, [copy.buffer])
					this.offset = 0
				}
			}
		}
		return true
	}
}
registerProcessor('mico-microphone', MicoMicrophoneProcessor)
`

export async function openMicrophone(
	onPcm: (pcm: Int16Array) => void,
	onEnded: (error?: Error) => void,
): Promise<{ stop(): Promise<void> }> {
	const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
	if (!mediaDevices?.getUserMedia) throw new Error('Microphone capture is not supported')

	const stream = await mediaDevices.getUserMedia({
		video: false,
		audio: {
			channelCount: { ideal: 1 },
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		},
	})

	const tracks =
		typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : stream.getTracks()
	let context: AudioContext | null = null
	let source: MediaStreamAudioSourceNode | null = null
	let worklet: AudioWorkletNode | null = null
	let gain: GainNode | null = null
	let stopped = false
	let tracksStopped = false
	let stopping = false
	let ended = false
	let pcmCarry = new Int16Array()
	let resampler: Pcm16Resampler | null = null
	let flushCaptureTail: (() => void) | null = null
	let stopPromise: Promise<void> | null = null
	let workletFlushResolve: (() => void) | null = null
	let workletFlushReject: ((error: Error) => void) | null = null
	const trackListeners = new Map<MediaStreamTrack, () => void>()
	let contextStateListener: (() => void) | null = null

	const flushPcmCarry = () => {
		if (pcmCarry.length === 0) return
		const partial = pcmCarry
		pcmCarry = new Int16Array()
		onPcm(partial)
	}

	const stopTracks = () => {
		if (tracksStopped) return
		tracksStopped = true
		for (const track of tracks) {
			try {
				track.stop()
			} catch {}
		}
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
			gain?.disconnect()
		} catch {}
		source = null
		worklet = null
		gain = null
		stopTracks()
		if (context) {
			const closing = context
			context = null
			try {
				const closeResult = closing.close()
				void Promise.resolve(closeResult).catch(() => {})
			} catch {}
		}
	}

	const flushWorklet = async (): Promise<void> => {
		if (!worklet)
			throw new Error(
				'Microphone worklet is unavailable; the final audio segment may be incomplete',
			)
		await new Promise<void>((resolve, reject) => {
			let settled = false
			let timeout: ReturnType<typeof setTimeout> | null = null
			const finishResolve = () => {
				if (settled) return
				settled = true
				if (timeout) clearTimeout(timeout)
				workletFlushResolve = null
				workletFlushReject = null
				resolve()
			}
			const finishReject = (error: Error) => {
				if (settled) return
				settled = true
				if (timeout) clearTimeout(timeout)
				workletFlushResolve = null
				workletFlushReject = null
				reject(error)
			}
			workletFlushResolve = finishResolve
			workletFlushReject = finishReject
			timeout = setTimeout(
				() =>
					finishReject(
						new Error(
							'Timed out waiting for microphone tail flush; the final audio segment may be incomplete',
						),
					),
				250,
			)
			try {
				worklet?.port.postMessage({ type: 'flush', id: 'mico-stop' })
			} catch (error) {
				finishReject(
					new Error(
						`Could not request the microphone tail flush: ${error instanceof Error ? error.message : 'unknown worklet error'}`,
					),
				)
			}
		})
	}

	const unexpectedEnd = () => {
		if (stopping || stopped || ended) return
		ended = true
		stopTracks()
		void (async () => {
			let failure: Error | undefined
			try {
				await flushWorklet()
				flushCaptureTail?.()
			} catch (error) {
				failure = error instanceof Error ? error : new Error('Microphone tail flush failed')
			} finally {
				stopped = true
				cleanupResources()
				onEnded(failure)
			}
		})()
	}

	const stop = (): Promise<void> => {
		if (stopPromise) return stopPromise
		if (stopped || ended) return Promise.resolve()
		stopPromise = (async () => {
			stopping = true
			stopTracks()
			try {
				await flushWorklet()
			} catch (error) {
				stopped = true
				cleanupResources()
				throw error
			}
			stopped = true
			try {
				flushCaptureTail?.()
			} finally {
				cleanupResources()
			}
		})()
		return stopPromise
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
		resampler = new Pcm16Resampler(context.sampleRate || 48000)
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
			if (stopped) return
			if (inputQueue.length >= 32) inputQueue.shift()
			inputQueue.push(input)
			while (inputQueue.length > 0) {
				const queued = inputQueue.shift()
				if (queued) appendPcm(resampler?.push(queued) ?? new Int16Array())
			}
		}
		flushCaptureTail = () => {
			if (resampler) appendPcm(resampler.flush())
			flushPcmCarry()
		}

		const WorkletConstructor = (
			globalThis as typeof globalThis & {
				AudioWorkletNode?: typeof AudioWorkletNode
			}
		).AudioWorkletNode
		if (
			!context.audioWorklet ||
			!WorkletConstructor ||
			typeof Blob === 'undefined' ||
			typeof URL === 'undefined'
		) {
			throw new Error('AudioWorklet microphone capture is not supported')
		}

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
			worklet.port.onmessage = (event: MessageEvent<unknown>) => {
				if (stopped) return
				const data = event.data as ArrayBuffer | { type?: string; buffer?: ArrayBuffer } | null
				if (data instanceof ArrayBuffer) {
					drainInput(new Float32Array(data))
					return
				}
				if (
					data &&
					typeof data === 'object' &&
					data.type === 'pcm' &&
					data.buffer instanceof ArrayBuffer
				) {
					drainInput(new Float32Array(data.buffer))
				}
				if (data && typeof data === 'object' && data.type === 'flushed') {
					workletFlushResolve?.()
				}
			}
			worklet.onprocessorerror = () => {
				if (stopping) {
					workletFlushReject?.(
						new Error(
							'Microphone worklet processor failed while flushing; the final audio segment may be incomplete',
						),
					)
					return
				}
				unexpectedEnd()
			}
			source.connect(worklet)
		} finally {
			if (moduleUrl) URL.revokeObjectURL(moduleUrl)
		}

		gain = context.createGain()
		gain.gain.value = 0
		gain.connect(context.destination)
		worklet.connect(gain)

		if (stopped || ended) throw new Error('Microphone capture ended')
		return { stop }
	} catch (error) {
		stopped = true
		cleanupResources()
		throw error
	}
}
