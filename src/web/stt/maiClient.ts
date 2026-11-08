const B64_CHUNK = 0x8000

export type MaiEvent = Record<string, unknown>

export interface MaiConfig {
	host: string
	deployment: string
	localPath: string
}

function base64FromBytes(bytes: Uint8Array): string {
	let binary = ''
	for (let index = 0; index < bytes.length; index += B64_CHUNK) {
		binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + B64_CHUNK)))
	}
	return btoa(binary)
}

type Handler = (event: MaiEvent) => void

function record(value: unknown): MaiEvent | null {
	return value !== null && typeof value === 'object' ? (value as MaiEvent) : null
}

export function maiEventItemId(event: MaiEvent): string | null {
	return typeof event.item_id === 'string' && event.item_id.trim() ? event.item_id : null
}

export function maiEventRequestId(event: MaiEvent): string | null {
	const nested = record(event.error)
	for (const candidate of [nested?.event_id, event.event_id]) {
		if (typeof candidate === 'string' && candidate.trim()) return candidate
	}
	return null
}

export function maiErrorCode(event: MaiEvent): string | null {
	const nested = record(event.error)
	for (const candidate of [nested?.code, event.code]) {
		if (typeof candidate === 'string' && candidate.trim()) return candidate
	}
	return null
}

export function maiEmptyAudioBufferError(event: MaiEvent): boolean {
	if (maiErrorCode(event) === 'input_audio_buffer_commit_empty') return true
	const nested = record(event.error)
	for (const candidate of [nested?.message, event.message]) {
		if (
			typeof candidate === 'string' &&
			candidate.toLowerCase().includes('input audio buffer is empty')
		)
			return true
	}
	return false
}

export function maiErrorMessage(event: MaiEvent): string {
	const nested = record(event.error)
	for (const candidate of [nested?.message, event.message]) {
		if (typeof candidate === 'string' && candidate.trim()) return candidate
	}
	const code = maiErrorCode(event)
	if (code) return `Transcription provider error: ${code}`
	for (const candidate of [nested?.type, event.type]) {
		if (typeof candidate === 'string' && candidate.trim()) {
			return `Transcription provider error: ${candidate}`
		}
	}
	return 'Transcription provider failed.'
}

export class MaiClient {
	private ws: WebSocket | null = null
	private readonly handlers = new Map<string, Handler[]>()
	private readonly model: string
	private readonly language: string | null
	private readonly path: string

	constructor({ path, model, language }: { path: string; model: string; language?: string }) {
		this.path = path
		this.model = model
		this.language = language ?? null
	}

	on(type: string, handler: Handler): this {
		const list = this.handlers.get(type) ?? []
		list.push(handler)
		this.handlers.set(type, list)
		return this
	}

	private emit(type: string, payload: MaiEvent): void {
		for (const handler of this.handlers.get(type) ?? []) handler(payload)
	}

	open(): Promise<void> {
		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
		const ws = new WebSocket(`${protocol}//${location.host}${this.path}?intent=transcription`)
		this.ws = ws

		return new Promise((resolve, reject) => {
			const timer = window.setTimeout(() => {
				ws.close()
				reject(new Error('Timed out waiting for session.updated'))
			}, 15_000)

			ws.onerror = () => reject(new Error('WebSocket connection failed'))
			ws.onclose = (event) => {
				window.clearTimeout(timer)
				this.emit('closed', { code: event.code, reason: event.reason })
				reject(new Error(`Connection closed ${event.code} ${event.reason}`.trim()))
			}
			ws.onopen = () => {
				this.emit('open', {})
				this.send({
					type: 'session.update',
					event_id: 'configure-1',
					session: {
						type: 'transcription',
						audio: {
							input: {
								format: { type: 'audio/pcm', rate: 16000 },
								transcription: {
									model: this.model,
									...(this.language ? { language: this.language } : {}),
								},
								turn_detection: null,
								noise_reduction: null,
							},
						},
					},
				})
			}
			ws.onmessage = (event) => {
				let message: MaiEvent
				try {
					message = JSON.parse(String(event.data)) as MaiEvent
				} catch {
					return
				}
				const type = typeof message.type === 'string' ? message.type : ''
				if (type === 'session.updated') {
					window.clearTimeout(timer)
					resolve()
					return
				}
				if (type === 'error' || type.endsWith('.failed')) {
					const nested = record(message.error)
					this.emit('error', nested ? { ...message, error: nested } : message)
					return
				}
				if (type === 'session.created') this.emit('created', message)
				else if (type.endsWith('input_audio_transcription.delta')) this.emit('delta', message)
				else if (type.endsWith('input_audio_transcription.intermediate'))
					this.emit('intermediate', message)
				else if (type.endsWith('input_audio_transcription.completed'))
					this.emit('completed', message)
				else if (type === 'input_audio_buffer.committed') this.emit('committed', message)
			}
		})
	}

	private send(payload: unknown): void {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload))
	}

	append(pcm: Int16Array, start: number, end: number): void {
		const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset + start * 2, (end - start) * 2)
		this.send({ type: 'input_audio_buffer.append', audio: base64FromBytes(bytes) })
	}

	commit(eventId?: string): void {
		this.send({
			type: 'input_audio_buffer.commit',
			...(eventId ? { event_id: eventId } : {}),
		})
	}

	close(): void {
		if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000, 'done')
		this.ws = null
	}
}
