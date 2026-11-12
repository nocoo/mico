export const TARGET_RATE = 16000
export const FRAME_SAMPLES = 1600

export interface LectureAudio {
	decoded: AudioBuffer
	pcm: Int16Array
	duration: number
	peaks: Float32Array
}

function toInt16(channel: Float32Array): Int16Array {
	const out = new Int16Array(channel.length)
	for (let index = 0; index < channel.length; index++) {
		const sample = Math.min(1, Math.max(-1, channel[index]))
		out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
	}
	return out
}

function computePeaks(pcm: Int16Array, buckets: number): Float32Array {
	const step = Math.max(1, Math.floor(pcm.length / buckets))
	const peaks = new Float32Array(buckets * 2)
	for (let bucket = 0; bucket < buckets; bucket++) {
		let min = 1
		let max = -1
		const start = bucket * step
		const end = Math.min(pcm.length, start + step)
		for (let index = start; index < end; index++) {
			const value = pcm[index] / 32768
			if (value < min) min = value
			if (value > max) max = value
		}
		peaks[bucket * 2] = min
		peaks[bucket * 2 + 1] = max
	}
	return peaks
}

export async function loadLecture(
	ctx: BaseAudioContext,
	url: string,
	bucketCount = 900,
): Promise<LectureAudio> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Could not load audio: HTTP ${response.status}`)
	const decoded = await ctx.decodeAudioData(await response.arrayBuffer())

	const frames = Math.ceil(decoded.duration * TARGET_RATE)
	const offline = new OfflineAudioContext(1, frames, TARGET_RATE)
	const source = offline.createBufferSource()
	source.buffer = decoded
	source.connect(offline.destination)
	source.start()
	const rendered = await offline.startRendering()
	const pcm = toInt16(rendered.getChannelData(0))

	return {
		decoded,
		pcm,
		duration: decoded.duration,
		peaks: computePeaks(pcm, bucketCount),
	}
}

export class Player {
	private readonly ctx: BaseAudioContext
	private readonly lecture: LectureAudio
	private source: AudioBufferSourceNode | null = null
	private startedAt = 0
	private offset = 0
	private rate = 1
	playing = false

	constructor(ctx: BaseAudioContext, lecture: LectureAudio) {
		this.ctx = ctx
		this.lecture = lecture
	}

	get position(): number {
		if (!this.playing) return this.offset
		const elapsed = (this.ctx.currentTime - this.startedAt) * this.rate
		return Math.min(this.lecture.duration, this.offset + elapsed)
	}

	get duration(): number {
		return this.lecture.duration
	}

	play(rate = this.rate): void {
		if (this.playing) this.pause()
		const source = this.ctx.createBufferSource()
		source.buffer = this.lecture.decoded
		source.playbackRate.value = rate
		source.connect(this.ctx.destination)
		this.rate = rate
		this.startedAt = this.ctx.currentTime
		source.start(0, this.offset)
		this.source = source
		this.playing = true
	}

	pause(): void {
		if (!this.playing) return
		this.offset = this.position
		this.playing = false
		const source = this.source
		this.source = null
		source?.stop()
		source?.disconnect()
	}

	reset(): void {
		this.pause()
		this.offset = 0
	}

	seekTo(seconds: number): void {
		const target = Math.max(0, Math.min(this.lecture.duration, seconds))
		if (this.playing) {
			this.pause()
			this.offset = target
			this.play()
		} else {
			this.offset = target
		}
	}
}
