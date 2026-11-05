import { openMicrophone } from './microphone.ts'
import { MossLivePlayback } from './mossPlayback.ts'

export type MossLiveEvent =
	| { type: 'status'; phase: 'connecting' | 'listening' | 'idle' }
	| { type: 'audio'; min: number; max: number }
	| {
			type: 'transcript'
			speaker: 'user' | 'assistant'
			text: string
			final: boolean
			turnId?: string
	  }
	| { type: 'tool'; name: string; phase: 'started' | 'done' | 'error' }
	| { type: 'warning'; message: string }
	| { type: 'error'; message: string }

export interface MossLiveMossTool {
	type?: string
	name: string
	description?: string
	parameters?: unknown
	[key: string]: unknown
}

export interface MossLiveSessionResponse {
	canvasId: string
	revision: number
	instructions: string
	tools: MossLiveMossTool[]
}

export interface MossLiveToolResponse {
	result: unknown
	revision?: number
}

interface CaptureHandle {
	stop(): Promise<void>
}

type CaptureFactory = (
	onPcm: (pcm: Int16Array) => void,
	onEnded: (error?: Error) => void,
) => Promise<CaptureHandle>

let captureFactory: CaptureFactory = openMicrophone

export function setMossLiveCaptureFactoryForTests(factory: CaptureFactory | null): void {
	captureFactory = factory ?? openMicrophone
}

const CONNECTION_TIMEOUT_MS = 15_000
const AUDIO_BACKPRESSURE_LIMIT = 128_000
const AUDIO_FRAME_SAMPLES = 320
const AUDIO_CONTEXT_LIMIT = 64

export class MossLiveSession {
	private lifecycle: 'stopped' | 'starting' | 'running' = 'stopped'
	private closed = true
	private generation = 0
	private startPromise: Promise<void> | null = null
	private socket: WebSocket | null = null
	private capture: CaptureHandle | null = null
	private outputContext: AudioContext | null = null
	private playback: MossLivePlayback | null = null
	private sessionAbort = new AbortController()
	private toolAbort = new AbortController()
	private connectTimer: ReturnType<typeof setTimeout> | null = null
	private ready = false
	private revision: number | null = null
	private sessionInstructions = ''
	private sessionTools: MossLiveMossTool[] = []
	private registeredTools = new Set<string>()
	private calls = new Set<string>()
	private toolChain: Promise<void> = Promise.resolve()
	private audioContexts: Record<string, unknown>[] = []
	private stoppedCaptures = new WeakSet<object>()

	private readonly options: {
		canvasId: string
		selection: string[]
		onEvent: (event: MossLiveEvent) => void
	}

	constructor(options: {
		canvasId: string
		selection: string[]
		onEvent: (event: MossLiveEvent) => void
	}) {
		this.options = options
	}

	private emit(event: MossLiveEvent): void {
		this.options.onEvent(event)
	}

	private isActive(generation = this.generation): boolean {
		return !this.closed && this.generation === generation
	}

	private stopCapture(capture: CaptureHandle): void {
		const handle = capture as object
		if (this.stoppedCaptures.has(handle)) return
		this.stoppedCaptures.add(handle)
		void Promise.resolve(capture.stop()).catch(() => {})
	}

	start(): Promise<void> {
		if (this.lifecycle === 'starting' || this.lifecycle === 'running') {
			return this.startPromise ?? Promise.resolve()
		}
		if (this.startPromise) {
			const previous = this.startPromise
			return previous.catch(() => {}).then(() => this.start())
		}
		const promise = this.beginStart()
		this.startPromise = promise
		void promise.then(
			() => {
				if (this.startPromise === promise) this.startPromise = null
			},
			() => {
				if (this.startPromise === promise) this.startPromise = null
			},
		)
		return promise
	}

	private async beginStart(): Promise<void> {
		const generation = ++this.generation
		this.closed = false
		this.lifecycle = 'starting'
		this.ready = false
		this.revision = null
		this.sessionInstructions = ''
		this.sessionTools = []
		this.registeredTools = new Set()
		this.calls = new Set()
		this.toolChain = Promise.resolve()
		this.audioContexts = []
		this.sessionAbort = new AbortController()
		this.toolAbort = new AbortController()
		this.emit({ type: 'status', phase: 'connecting' })

		let outputContext: AudioContext | null = null
		let resumeOutput: Promise<void> = Promise.resolve()
		const AudioContextConstructor = (
			globalThis as typeof globalThis & {
				AudioContext?: typeof AudioContext
			}
		).AudioContext
		try {
			if (!AudioContextConstructor) throw new Error('Web Audio is not supported')
			outputContext = new AudioContextConstructor({ sampleRate: 48000 })
			this.outputContext = outputContext
			resumeOutput = Promise.resolve(outputContext.resume()).then(() => {})
		} catch (error) {
			if (this.isActive(generation)) {
				this.fail(
					error instanceof Error
						? `Could not start: ${error.message}`
						: 'Could not start audio playback.',
				)
			}
			return
		}

		const sessionPromise = this.fetchSession(generation)
		let capturePromise: Promise<CaptureHandle>
		try {
			capturePromise = captureFactory(
				(pcm) => this.handlePcm(generation, pcm),
				(error) => {
					if (!this.isActive(generation)) return
					this.fail(
						error?.message
							? `Microphone stopped: ${error.message}`
							: 'Microphone stopped; please start again.',
					)
				},
			)
		} catch (error) {
			capturePromise = Promise.reject(error)
		}
		capturePromise = capturePromise.then((capture) => {
			if (!this.isActive(generation)) {
				this.stopCapture(capture)
				return capture
			}
			this.capture = capture
			return capture
		})

		try {
			const [session, capture] = await Promise.all([
				sessionPromise,
				capturePromise,
				resumeOutput,
			]).then((values) => [values[0], values[1]] as const)
			if (!this.isActive(generation)) {
				this.stopCapture(capture)
				return
			}
			this.revision = session.revision
			this.sessionInstructions = session.instructions
			this.sessionTools = session.tools
			this.registeredTools = new Set(session.tools.map((tool) => tool.name).filter(Boolean))
			this.capture = capture
			this.playback = new MossLivePlayback(
				outputContext as unknown as ConstructorParameters<typeof MossLivePlayback>[0],
				(event) => this.send(event),
				(message) => this.fail(message),
			)
			this.lifecycle = 'running'
			this.openSocket(generation)
		} catch (error) {
			if (!this.isActive(generation)) return
			const name = error instanceof DOMException ? error.name : ''
			if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
				this.fail('Microphone permission is required to start.')
				return
			}
			if (error instanceof DOMException && error.name === 'AbortError') return
			this.fail(
				error instanceof Error
					? `Could not start: ${error.message}`
					: 'Could not start MOSS Live session.',
			)
		}
	}

	private async fetchSession(generation: number): Promise<MossLiveSessionResponse> {
		const controller = new AbortController()
		const abort = () => controller.abort()
		this.sessionAbort.signal.addEventListener('abort', abort, { once: true })
		let timedOut = false
		const timer = setTimeout(() => {
			timedOut = true
			controller.abort()
		}, CONNECTION_TIMEOUT_MS)
		try {
			const response = await fetch('/api/moss/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					canvasId: this.options.canvasId,
					selection: this.options.selection,
				}),
				signal: controller.signal,
			})
			let body: unknown
			try {
				body = await response.json()
			} catch {
				throw new Error('MOSS session response was not valid JSON')
			}
			if (!response.ok) {
				throw new Error(this.errorMessage(body, `MOSS session request failed (${response.status})`))
			}
			const session = body as Partial<MossLiveSessionResponse>
			if (
				typeof session.canvasId !== 'string' ||
				typeof session.revision !== 'number' ||
				typeof session.instructions !== 'string' ||
				!Array.isArray(session.tools)
			) {
				throw new Error('MOSS session response is invalid')
			}
			if (session.canvasId !== this.options.canvasId) {
				throw new Error('MOSS session returned a different canvas')
			}
			if (!this.isActive(generation)) throw new DOMException('Session stopped', 'AbortError')
			return session as MossLiveSessionResponse
		} catch (error) {
			if (timedOut) throw new Error('Connection timed out; please check the network and try again.')
			throw error
		} finally {
			clearTimeout(timer)
			this.sessionAbort.signal.removeEventListener('abort', abort)
		}
	}

	private openSocket(generation: number): void {
		const protocol = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:'
		const host = globalThis.location?.host || 'localhost'
		const socket = new WebSocket(`${protocol}//${host}/moss`)
		socket.binaryType = 'arraybuffer'
		this.socket = socket
		this.connectTimer = setTimeout(() => {
			if (this.isActive(generation))
				this.fail('Connection timed out; please check the network and try again.')
		}, CONNECTION_TIMEOUT_MS)

		socket.onerror = () => {
			if (this.isActive(generation))
				this.fail('Connection failed; check the local service and network.')
		}
		socket.onclose = () => {
			if (this.isActive(generation)) this.fail('Connection closed; please start again.')
		}
		socket.onmessage = (event) => {
			if (this.isActive(generation)) this.handleMessage(event.data)
		}
	}

	private send(event: Record<string, unknown>): void {
		if (this.socket && this.socket.readyState === (globalThis.WebSocket?.OPEN ?? 1)) {
			this.socket.send(JSON.stringify(event))
		}
	}

	private handlePcm(generation: number, pcm: Int16Array): void {
		if (!this.isActive(generation)) return
		let min = 1
		let max = -1
		for (let index = 0; index < pcm.length; index++) {
			const sample = pcm[index] / 32768
			if (sample < min) min = sample
			if (sample > max) max = sample
		}
		if (pcm.length > 0) this.emit({ type: 'audio', min, max })
		if (!this.ready || !this.socket || this.socket.readyState !== (globalThis.WebSocket?.OPEN ?? 1))
			return
		if (this.socket.bufferedAmount > AUDIO_BACKPRESSURE_LIMIT) {
			this.fail('Network congestion stopped audio sending.')
			return
		}
		for (let offset = 0; offset < pcm.length; offset += AUDIO_FRAME_SAMPLES) {
			const length = Math.min(AUDIO_FRAME_SAMPLES, pcm.length - offset)
			const bytes = new ArrayBuffer(length * 2)
			const view = new DataView(bytes)
			for (let index = 0; index < length; index++) {
				view.setInt16(index * 2, pcm[offset + index], true)
			}
			this.socket.send(bytes)
			if (this.socket.bufferedAmount > AUDIO_BACKPRESSURE_LIMIT) {
				this.fail('Network congestion stopped audio sending.')
				return
			}
		}
	}

	private handleMessage(message: unknown): void {
		if (message instanceof ArrayBuffer) {
			this.handleBinary(message)
			return
		}
		if (message instanceof Uint8Array) {
			const copy = new Uint8Array(message.byteLength)
			copy.set(message)
			this.handleBinary(copy.buffer)
			return
		}

		let event: { action?: string; data?: Record<string, unknown>; message?: string }
		try {
			event = typeof message === 'string' ? JSON.parse(message) : JSON.parse(String(message))
		} catch {
			this.fail('Received an unreadable server message.')
			return
		}
		const data = event.data ?? {}
		switch (event.action) {
			case 'proxy.ready':
				this.send({ action: 'attach_session', delegation: 'client' })
				break
			case 'session_attached':
				if (data.delegation !== 'client') {
					this.fail('Server did not enable client tool delegation.')
					return
				}
				this.send({
					action: 'session.update',
					session: { instructions: this.instructions(), tools: this.sessionTools },
				})
				break
			case 'session.updated': {
				if (data.error) {
					this.fail(
						`Session configuration failed: ${this.errorMessage(data.error, 'unknown error')}`,
					)
					return
				}
				const names = Array.isArray(data.tools)
					? data.tools.map((tool) =>
							typeof tool === 'string'
								? tool
								: typeof tool === 'object' &&
										tool &&
										typeof (tool as Record<string, unknown>).name === 'string'
									? String((tool as Record<string, unknown>).name)
									: '',
						)
					: []
				const missing = [...this.registeredTools].filter((name) => !names.includes(name))
				if (missing.length > 0) {
					this.fail(`Server did not confirm tools: ${missing.join(', ')}`)
					return
				}
				if (this.connectTimer) clearTimeout(this.connectTimer)
				this.connectTimer = null
				this.ready = true
				this.send({ action: 'mic_state', enabled: true })
				this.emit({ type: 'status', phase: 'listening' })
				break
			}
			case 'input.transcript.updated':
				this.emit({
					type: 'transcript',
					speaker: 'user',
					text: this.string(data.text),
					final: false,
				})
				break
			case 'input.transcript.done':
				this.emit({
					type: 'transcript',
					speaker: 'user',
					text: this.string(data.text),
					final: true,
				})
				break
			case 'output.transcript.updated':
				this.emit({
					type: 'transcript',
					speaker: 'assistant',
					text: this.string(data.text),
					final: false,
					turnId: this.optionalString(data.turn_id),
				})
				break
			case 'output.transcript.done':
				this.emit({
					type: 'transcript',
					speaker: 'assistant',
					text: this.string(data.text),
					final: true,
					turnId: this.optionalString(data.turn_id),
				})
				break
			case 'response.audio.context':
				if (this.audioContexts.length >= AUDIO_CONTEXT_LIMIT) {
					this.fail('Playback audio context buffer limit exceeded')
					return
				}
				this.audioContexts.push(data)
				break
			case 'response.audio.done':
				this.playback?.done(data)
				break
			case 'response.audio.stop':
				this.playback?.stop(data)
				break
			case 'response.interrupted':
				this.playback?.stopAll()
				break
			case 'response.function_call_arguments.done':
				this.runTool(data)
				break
			case 'response.ended': {
				if (data.status === 'failed') {
					const ids = [
						['run', data.run_id],
						['turn', data.turn_id],
					]
						.filter((entry) => typeof entry[1] === 'string' && /^[\w.-]{1,120}$/.test(entry[1]))
						.map(([name, value]) => `${name}: ${value}`)
					const message = this.errorMessage(
						data.error ?? data.status_details,
						'This response failed; you can keep speaking and retry.',
					)
					this.emit({
						type: 'warning',
						message: `${message}${ids.length ? ` (${ids.join(', ')})` : ''}`,
					})
				}
				break
			}
			case 'proxy.error':
				this.fail(this.string(event.message) || 'MOSS proxy connection failed.')
				break
			case 'error':
				this.fail(this.errorMessage(data.error, 'MOSS Live returned an error.'))
				break
		}
	}

	private instructions(): string {
		return this.sessionInstructions
	}

	private handleBinary(bytes: ArrayBuffer): void {
		const context = this.audioContexts.shift()
		if (!context) {
			this.fail('Received playback audio without an audio context.')
			return
		}
		try {
			this.playback?.enqueue(context, bytes)
		} catch (error) {
			this.fail(error instanceof Error ? error.message : 'Playback audio failed')
		}
	}

	private runTool(data: Record<string, unknown>): void {
		const callId = this.optionalString(data.call_id)
		const name = this.optionalString(data.name)
		if (!callId || !name || this.calls.has(callId) || this.closed) return
		this.calls.add(callId)
		this.emit({ type: 'tool', name, phase: 'started' })

		this.toolChain = this.toolChain
			.catch(() => {})
			.then(async () => {
				if (!this.isActive()) return
				let input: unknown
				if (typeof data.arguments === 'string') {
					try {
						input = JSON.parse(data.arguments)
					} catch {
						await this.toolFailure(callId, name, 'Tool arguments were not valid JSON')
						return
					}
				} else {
					input = data.arguments ?? {}
				}
				if (!this.registeredTools.has(name)) {
					await this.toolFailure(callId, name, `Unknown tool: ${name}`)
					return
				}

				const toolRevision = this.revision
				if (toolRevision === null) {
					await this.toolFailure(callId, name, 'MOSS session revision is unavailable')
					return
				}

				try {
					const response = await fetch('/api/moss/tool', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							canvasId: this.options.canvasId,
							selection: this.options.selection,
							revision: toolRevision,
							name,
							input,
						}),
						signal: this.toolAbort.signal,
					})
					let body: unknown
					try {
						body = await response.json()
					} catch {
						body = null
					}
					this.updateRevision(body)
					if (!response.ok) {
						const message = this.errorMessage(
							body,
							`Canvas tool request failed (${response.status})`,
						)
						const record =
							body && typeof body === 'object' ? (body as Record<string, unknown>) : null
						await this.toolFailure(
							callId,
							name,
							message,
							record && Object.hasOwn(record, 'result') ? record.result : body,
						)
						return
					}
					const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
					if (!record || !Object.hasOwn(record, 'result')) {
						await this.toolFailure(callId, name, 'Canvas tool response did not contain a result')
						return
					}
					const result = record.result
					const failed = this.isToolFailure(result)
					if (failed) {
						this.emit({ type: 'tool', name, phase: 'error' })
						const output = JSON.stringify(result)
						this.send({
							action: 'conversation.item.create',
							item: {
								type: 'function_call_output',
								call_id: callId,
								output:
									typeof output === 'string'
										? output
										: JSON.stringify({ ok: false, error: 'Canvas tool execution failed' }),
							},
						})
						return
					}
					if (!this.isActive()) return
					this.emit({ type: 'tool', name, phase: 'done' })
					const output = JSON.stringify(result)
					this.send({
						action: 'conversation.item.create',
						item: {
							type: 'function_call_output',
							call_id: callId,
							output:
								typeof output === 'string'
									? output
									: JSON.stringify({ success: false, error: 'Canvas tool returned no result' }),
						},
					})
				} catch (error) {
					if (!this.isActive()) return
					if (error instanceof DOMException && error.name === 'AbortError') return
					await this.toolFailure(
						callId,
						name,
						error instanceof Error ? error.message : 'Canvas tool execution failed',
					)
				}
			})
	}

	private isToolFailure(result: unknown): boolean {
		if (!result || typeof result !== 'object') return false
		const record = result as Record<string, unknown>
		return record.ok === false || record.success === false
	}

	private async toolFailure(
		callId: string,
		name: string,
		message: string,
		actualResult?: unknown,
	): Promise<void> {
		if (!this.isActive()) return
		const result = actualResult ?? { ok: false, error: message }
		this.emit({ type: 'tool', name, phase: 'error' })
		this.send({
			action: 'conversation.item.create',
			item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
		})
	}

	private updateRevision(body: unknown): void {
		if (!body || typeof body !== 'object') return
		const record = body as Record<string, unknown>
		if (typeof record.revision === 'number') {
			this.revision = record.revision
			return
		}
		const result = record.result
		if (result && typeof result === 'object') {
			const nested = (result as Record<string, unknown>).revision
			if (typeof nested === 'number') this.revision = nested
		}
	}

	private errorMessage(value: unknown, fallback: string): string {
		if (!value) return fallback
		if (typeof value === 'string') return value
		if (typeof value !== 'object') return fallback
		const record = value as Record<string, unknown>
		if (typeof record.message === 'string') return record.message
		if (typeof record.error === 'string') return record.error
		if (record.error && typeof record.error === 'object') {
			const nested = (record.error as Record<string, unknown>).message
			if (typeof nested === 'string') return nested
		}
		return fallback
	}

	private string(value: unknown): string {
		return typeof value === 'string' ? value : ''
	}

	private optionalString(value: unknown): string | undefined {
		return typeof value === 'string' && value ? value : undefined
	}

	private fail(message: string): void {
		if (this.closed) return
		this.emit({ type: 'error', message })
		this.close(true)
	}

	stop(): void {
		this.close(false)
	}

	private close(fromFailure: boolean): void {
		const wasActive = !this.closed || this.lifecycle !== 'stopped'
		this.closed = true
		this.ready = false
		this.lifecycle = 'stopped'
		this.generation++
		if (this.connectTimer) clearTimeout(this.connectTimer)
		this.connectTimer = null
		this.sessionAbort.abort()
		this.toolAbort.abort()

		if (this.socket) {
			this.socket.onmessage = null
			this.socket.onerror = null
			this.socket.onclose = null
			if (
				this.socket.readyState === (globalThis.WebSocket?.OPEN ?? 1) ||
				this.socket.readyState === (globalThis.WebSocket?.CONNECTING ?? 0)
			) {
				this.socket.close(1000, 'done')
			}
			this.socket = null
		}
		this.playback?.close()
		this.playback = null
		this.audioContexts = []
		if (this.capture) {
			this.stopCapture(this.capture)
			this.capture = null
		}
		if (this.outputContext) {
			const context = this.outputContext
			this.outputContext = null
			void Promise.resolve(context.close()).catch(() => {})
		}
		if (wasActive || fromFailure) this.emit({ type: 'status', phase: 'idle' })
	}
}
