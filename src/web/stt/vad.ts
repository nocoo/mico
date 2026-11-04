const FRAME_MS = 20
const DB_RAISE_PER_FRAME = 0.02
const MIN_THRESHOLD_DB = -55
const THRESHOLD_ABOVE_FLOOR_DB = 12

const toDb = (rms: number) => (rms <= 0 ? -90 : 20 * Math.log10(rms))

function frameRms(pcm: Int16Array, start: number, end: number): number {
	let sum = 0
	for (let index = start; index < end; index++) {
		const value = pcm[index] / 32768
		sum += value * value
	}
	return Math.sqrt(sum / Math.max(1, end - start))
}

function concat(a: Int16Array, b: Int16Array): Int16Array {
	const out = new Int16Array(a.length + b.length)
	out.set(a, 0)
	out.set(b, a.length)
	return out
}

export class SilenceSegmenter {
	private readonly frameSamples: number
	private silenceMs = 500
	private readonly minSpeechMs = 300
	private readonly maxSegmentMs = 15_000
	private carry: Int16Array | null = null
	private lastTrailingMs = 0
	private floorDb = -70
	private silenceRunMs = 0
	private speechRunMs = 0
	private segmentMs = 0
	private speakingNow = false
	private recent: number[] = []
	db = -90

	constructor({ rate = 16000 } = {}) {
		this.frameSamples = Math.round((rate * FRAME_MS) / 1000)
	}

	get speaking(): boolean {
		return this.speakingNow
	}

	get peakDb(): number {
		return this.recent.length ? Math.max(...this.recent) : this.db
	}

	get currentSilenceMs(): number {
		return this.silenceMs
	}

	get lastTrailingMsValue(): number {
		return this.lastTrailingMs
	}

	setSilenceMs(ms: number): void {
		this.silenceMs = ms
	}

	reset(): void {
		this.carry = null
		this.lastTrailingMs = 0
		this.floorDb = -70
		this.silenceRunMs = 0
		this.speechRunMs = 0
		this.segmentMs = 0
		this.speakingNow = false
		this.recent = []
		this.db = -90
	}

	push(chunk: Int16Array): boolean {
		const data = this.carry ? concat(this.carry, chunk) : chunk
		const frames = Math.floor(data.length / this.frameSamples)
		let commit = false

		for (let frame = 0; frame < frames; frame++) {
			const start = frame * this.frameSamples
			const db = toDb(frameRms(data, start, start + this.frameSamples))
			this.db = db
			this.recent.push(db)
			if (this.recent.length > 5) this.recent.shift()
			const threshold = Math.max(this.floorDb + THRESHOLD_ABOVE_FLOOR_DB, MIN_THRESHOLD_DB)
			const voiced = db > threshold

			if (db < this.floorDb) this.floorDb = db
			else if (!voiced) this.floorDb = Math.min(db, this.floorDb + DB_RAISE_PER_FRAME)

			this.segmentMs += FRAME_MS
			if (voiced) {
				this.speechRunMs += FRAME_MS
				this.silenceRunMs = 0
				this.speakingNow = true
			} else {
				this.silenceRunMs += FRAME_MS
			}

			const paused = this.speakingNow && this.silenceRunMs >= this.silenceMs
			if ((paused && this.speechRunMs >= this.minSpeechMs) || this.segmentMs >= this.maxSegmentMs) {
				commit = true
				this.lastTrailingMs = this.silenceRunMs
				this.speakingNow = false
				this.speechRunMs = 0
				this.silenceRunMs = 0
				this.segmentMs = 0
			}
		}

		const consumed = frames * this.frameSamples
		this.carry = consumed < data.length ? data.slice(consumed) : null
		return commit
	}
}
