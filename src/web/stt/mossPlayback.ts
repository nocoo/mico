export interface MossPlaybackContext {
	run_id?: string
	turn_id?: string
	chunk_id?: string
}

export interface MossPlaybackSource {
	connect(destination: unknown): unknown
	start(when: number): void
	stop(): void
	disconnect?: () => void
	onended: (() => void) | null
	buffer: AudioBuffer
}

export interface MossPlaybackAudioContext {
	readonly currentTime: number
	readonly destination: unknown
	createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer
	createBufferSource(): MossPlaybackSource
}

export type MossPlaybackSend = (event: Record<string, unknown>) => void

export const MOSS_PLAYBACK_MAX_CHUNKS = 64
export const MOSS_PLAYBACK_MAX_BYTES = 4 * 1024 * 1024

interface PlaybackChunk {
	source: MossPlaybackSource
	start: number
	duration: number
	id: string
	acked: boolean
	bytes: number
}

interface PlaybackTurn {
	runId: string
	turnId: string
	chunks: Set<PlaybackChunk>
	done: boolean
	stopped: boolean
	completed: boolean
}

export class MossLivePlayback {
	private readonly turns = new Map<string, PlaybackTurn>()
	private nextTime = 0
	private queuedBytes = 0
	private readonly context: MossPlaybackAudioContext
	private readonly send: MossPlaybackSend
	private readonly onError: (message: string) => void

	constructor(
		context: MossPlaybackAudioContext,
		send: MossPlaybackSend,
		onError: (message: string) => void = () => {},
	) {
		this.context = context
		this.send = send
		this.onError = onError
	}

	private turn(data: MossPlaybackContext): PlaybackTurn {
		const runId = data.run_id ?? ''
		const turnId = data.turn_id ?? ''
		const key = `${runId}:${turnId}`
		let turn = this.turns.get(key)
		if (!turn) {
			turn = { runId, turnId, chunks: new Set(), done: false, stopped: false, completed: false }
			this.turns.set(key, turn)
		}
		return turn
	}

	enqueue(data: MossPlaybackContext, bytes: ArrayBuffer): void {
		const turn = this.turn(data)
		if (turn.stopped) return
		if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
			this.onError('Received invalid 48 kHz PCM playback audio')
			return
		}
		if (
			turn.chunks.size >= MOSS_PLAYBACK_MAX_CHUNKS ||
			this.queuedBytes + bytes.byteLength > MOSS_PLAYBACK_MAX_BYTES
		) {
			this.onError('Playback audio buffer limit exceeded')
			return
		}

		const raw = new DataView(bytes)
		const buffer = this.context.createBuffer(1, bytes.byteLength / 2, 48000)
		const samples = buffer.getChannelData(0)
		for (let index = 0; index < samples.length; index++) {
			samples[index] = raw.getInt16(index * 2, true) / 32768
		}

		const source = this.context.createBufferSource()
		source.buffer = buffer
		source.connect(this.context.destination)
		const start = Math.max(this.context.currentTime, this.nextTime)
		const chunk: PlaybackChunk = {
			source,
			start,
			duration: buffer.duration,
			id: data.chunk_id ?? '',
			acked: false,
			bytes: bytes.byteLength,
		}
		turn.chunks.add(chunk)
		this.queuedBytes += bytes.byteLength
		this.nextTime = start + buffer.duration

		source.onended = () => {
			if (!turn.chunks.delete(chunk)) return
			this.queuedBytes = Math.max(0, this.queuedBytes - bytes.byteLength)
			if (!turn.stopped && !chunk.acked) {
				chunk.acked = true
				this.send({
					action: 'playback.chunk.completed',
					chunk_id: chunk.id,
					run_id: turn.runId,
					turn_id: turn.turnId,
				})
				this.complete(turn)
			}
			source.disconnect?.()
		}
		source.start(start)
	}

	done(data: MossPlaybackContext): void {
		const turn = this.turn(data)
		turn.done = true
		this.complete(turn)
	}

	private complete(turn: PlaybackTurn): void {
		if (turn.done && !turn.stopped && !turn.completed && turn.chunks.size === 0) {
			turn.completed = true
			this.send({
				action: 'playback.completed',
				run_id: turn.runId,
				turn_id: turn.turnId,
			})
		}
	}

	stop(data: MossPlaybackContext = {}, acknowledge = true): void {
		const turn = this.turn(data)
		if (turn.stopped) return
		turn.stopped = true
		const current = [...turn.chunks].find((chunk) => this.context.currentTime >= chunk.start)
		const played = current
			? Math.round(
					Math.min(current.duration, Math.max(0, this.context.currentTime - current.start)) * 1000,
				)
			: 0

		for (const chunk of turn.chunks) {
			chunk.acked = true
			chunk.source.stop()
			chunk.source.disconnect?.()
		}
		this.queuedBytes = Math.max(
			0,
			this.queuedBytes - [...turn.chunks].reduce((bytes, chunk) => bytes + chunk.bytes, 0),
		)
		turn.chunks.clear()
		this.nextTime = Math.max(
			this.context.currentTime,
			...[...this.turns.values()].flatMap((other) =>
				[...other.chunks].map((chunk) => chunk.start + chunk.duration),
			),
		)
		if (acknowledge) {
			this.send({
				action: 'playback.stopped',
				run_id: turn.runId,
				turn_id: turn.turnId,
				played_audio_ms: played,
			})
		}
	}

	stopAll(acknowledge = true): void {
		for (const turn of [...this.turns.values()]) {
			if (!turn.stopped) this.stopForTurn(turn, acknowledge)
		}
		this.nextTime = this.context.currentTime
	}

	private stopForTurn(turn: PlaybackTurn, acknowledge: boolean): void {
		if (turn.stopped) return
		turn.stopped = true
		const current = [...turn.chunks].find((chunk) => this.context.currentTime >= chunk.start)
		const played = current
			? Math.round(
					Math.min(current.duration, Math.max(0, this.context.currentTime - current.start)) * 1000,
				)
			: 0
		this.queuedBytes = Math.max(
			0,
			this.queuedBytes - [...turn.chunks].reduce((bytes, chunk) => bytes + chunk.bytes, 0),
		)
		for (const chunk of turn.chunks) {
			chunk.acked = true
			chunk.source.stop()
			chunk.source.disconnect?.()
		}
		turn.chunks.clear()
		this.nextTime = this.context.currentTime
		if (acknowledge) {
			this.send({
				action: 'playback.stopped',
				run_id: turn.runId,
				turn_id: turn.turnId,
				played_audio_ms: played,
			})
		}
	}

	close(): void {
		for (const turn of this.turns.values()) this.stopForTurn(turn, false)
		this.turns.clear()
		this.queuedBytes = 0
	}
}

export { MossLivePlayback as Playback }
