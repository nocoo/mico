export const DEFAULT_AUDIO_HELPER_URL = 'http://127.0.0.1:47065'
export const AUDIO_HELPER_PROBE_TIMEOUT_MS = 450
export const AUDIO_HELPER_STOP_TIMEOUT_MS = 2000

export type AudioHelperStatus = 'unavailable' | 'needs-permission' | 'ready'

export interface AudioHelperHealth {
	readonly app: 'mico-helper'
	readonly version: string
	readonly platform: string
	readonly ready: boolean
	readonly capturing: boolean
	readonly permissions: {
		readonly microphone: string
		readonly systemAudio: string
	}
	readonly activeDevice: string
	readonly sampleRate: number
	readonly channels: number
	readonly encoding: string
}

export interface AudioHelperProbeResult {
	readonly status: AudioHelperStatus
	readonly health: AudioHelperHealth | null
}

export type AudioHelperErrorCode = 'permissions_required' | 'busy' | 'capture_failed' | 'connection'

export class AudioHelperError extends Error {
	readonly code: AudioHelperErrorCode

	constructor(code: AudioHelperErrorCode, message: string) {
		super(message)
		this.name = 'AudioHelperError'
		this.code = code
	}
}

interface HelperGlobal {
	__MICO_AUDIO_HELPER_URL__?: string
}

function isLoopbackHost(hostname: string): boolean {
	const lower = hostname.toLowerCase()
	return lower === '127.0.0.1' || lower === 'localhost' || lower === '[::1]' || lower === '::1'
}

function parseAllowedBaseUrl(raw: string | null | undefined): string | null {
	if (!raw) return null
	try {
		const parsed = new URL(raw)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		if (!isLoopbackHost(parsed.hostname)) return null
		return parsed.origin
	} catch {
		return null
	}
}

export function resolveAudioHelperBaseUrl(): string {
	const override = parseAllowedBaseUrl((globalThis as HelperGlobal).__MICO_AUDIO_HELPER_URL__)
	if (override) return override

	if (typeof window !== 'undefined' && typeof window.location?.search === 'string') {
		const params = new URLSearchParams(window.location.search)
		const fromQuery = parseAllowedBaseUrl(params.get('helperUrl'))
		if (fromQuery) return fromQuery
	}

	return DEFAULT_AUDIO_HELPER_URL
}

function isValidHealthPayload(value: unknown): value is AudioHelperHealth {
	if (!value || typeof value !== 'object') return false
	const record = value as Record<string, unknown>
	const perms = record.permissions as Record<string, unknown> | undefined
	return (
		record.app === 'mico-helper' &&
		typeof record.ready === 'boolean' &&
		typeof record.capturing === 'boolean' &&
		record.sampleRate === 16000 &&
		record.channels === 1 &&
		record.encoding === 'pcm_s16le' &&
		typeof record.activeDevice === 'string' &&
		Boolean(perms) &&
		typeof perms?.microphone === 'string' &&
		typeof perms?.systemAudio === 'string'
	)
}

export interface ProbeAudioHelperOptions {
	readonly baseUrl?: string
	readonly timeoutMs?: number
	readonly fetchImpl?: typeof fetch
}

export async function probeAudioHelper(
	options?: ProbeAudioHelperOptions,
): Promise<AudioHelperProbeResult> {
	const fetchImpl = options?.fetchImpl ?? globalThis.fetch
	if (typeof fetchImpl !== 'function') {
		return { status: 'unavailable', health: null }
	}
	const baseUrl = options?.baseUrl ?? resolveAudioHelperBaseUrl()
	const timeoutMs = options?.timeoutMs ?? AUDIO_HELPER_PROBE_TIMEOUT_MS
	const controller = typeof AbortController === 'function' ? new AbortController() : null
	const timer =
		controller && timeoutMs > 0
			? setTimeout(() => {
					controller.abort()
				}, timeoutMs)
			: null

	try {
		const response = await fetchImpl(`${baseUrl}/health`, {
			method: 'GET',
			cache: 'no-store',
			signal: controller?.signal,
		})
		if (!response.ok) return { status: 'unavailable', health: null }
		const payload = (await response.json()) as unknown
		if (!isValidHealthPayload(payload)) return { status: 'unavailable', health: null }
		return {
			status: payload.ready ? 'ready' : 'needs-permission',
			health: payload,
		}
	} catch {
		return { status: 'unavailable', health: null }
	} finally {
		if (timer !== null) clearTimeout(timer)
	}
}

export async function openAudioHelperPermissions(
	options?: ProbeAudioHelperOptions,
): Promise<boolean> {
	const fetchImpl = options?.fetchImpl ?? globalThis.fetch
	if (typeof fetchImpl !== 'function') return false
	const baseUrl = options?.baseUrl ?? resolveAudioHelperBaseUrl()
	const controller = typeof AbortController === 'function' ? new AbortController() : null
	const timer = controller
		? setTimeout(() => {
				controller.abort()
			}, 1200)
		: null

	try {
		const response = await fetchImpl(`${baseUrl}/open-permissions`, {
			method: 'POST',
			cache: 'no-store',
			signal: controller?.signal,
		})
		return response.ok
	} catch {
		return false
	} finally {
		if (timer !== null) clearTimeout(timer)
	}
}

function toWebSocketUrl(baseUrl: string): string {
	const parsed = new URL('/stream', baseUrl)
	parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
	return parsed.toString()
}

function bufferToInt16(buffer: ArrayBuffer): Int16Array {
	const evenLength = buffer.byteLength - (buffer.byteLength % 2)
	if (evenLength <= 0) return new Int16Array()
	return new Int16Array(buffer.slice(0, evenLength))
}

function normalizeErrorCode(raw: unknown): AudioHelperErrorCode {
	if (raw === 'permissions_required' || raw === 'busy' || raw === 'capture_failed') return raw
	return 'connection'
}

export interface OpenAudioHelperStreamOptions {
	readonly baseUrl?: string
	readonly stopTimeoutMs?: number
	readonly WebSocketImpl?: typeof WebSocket
}

export async function openAudioHelperStream(
	onPcm: (pcm: Int16Array) => void,
	onEnded: (error?: Error) => void,
	options?: OpenAudioHelperStreamOptions,
): Promise<{ stop(): Promise<void> }> {
	const WebSocketImpl = options?.WebSocketImpl ?? globalThis.WebSocket
	if (typeof WebSocketImpl !== 'function') {
		throw new AudioHelperError('connection', 'WebSocket is not available for Mico Helper.')
	}

	const baseUrl = options?.baseUrl ?? resolveAudioHelperBaseUrl()
	const stopTimeoutMs = options?.stopTimeoutMs ?? AUDIO_HELPER_STOP_TIMEOUT_MS
	const socket = new WebSocketImpl(toWebSocketUrl(baseUrl))
	socket.binaryType = 'arraybuffer'

	let started = false
	let stopping = false
	let closed = false
	let endedNotified = false
	let stopPromise: Promise<void> | null = null
	let resolveStop: (() => void) | null = null

	const finishStop = () => {
		if (!resolveStop) return
		const done = resolveStop
		resolveStop = null
		done()
	}

	const notifyEnded = (error?: Error) => {
		if (endedNotified) return
		endedNotified = true
		onEnded(error)
	}

	const stop = (): Promise<void> => {
		if (stopPromise) return stopPromise
		if (closed) return Promise.resolve()
		stopping = true
		stopPromise = new Promise<void>((resolve) => {
			let settled = false
			const finish = () => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				resolveStop = null
				try {
					if (
						socket.readyState === WebSocketImpl.OPEN ||
						socket.readyState === WebSocketImpl.CONNECTING
					) {
						socket.close(1000, 'stopped')
					}
				} catch {}
				resolve()
			}
			resolveStop = finish
			const timer = setTimeout(finish, stopTimeoutMs)

			if (socket.readyState === WebSocketImpl.OPEN) {
				try {
					socket.send(JSON.stringify({ type: 'stop' }))
				} catch {
					finish()
				}
			} else if (
				socket.readyState === WebSocketImpl.CLOSING ||
				socket.readyState === WebSocketImpl.CLOSED
			) {
				finish()
			} else {
				finish()
			}
		})
		return stopPromise
	}

	await new Promise<void>((resolve, reject) => {
		let settledStart = false
		const settleStart = (error?: Error) => {
			if (settledStart) return
			settledStart = true
			if (error) reject(error)
			else resolve()
		}

		const handleBinary = (buffer: ArrayBuffer) => {
			const pcm = bufferToInt16(buffer)
			if (pcm.length > 0) onPcm(pcm)
		}

		socket.addEventListener('message', (event: MessageEvent) => {
			if (event.data instanceof ArrayBuffer) {
				handleBinary(event.data)
				return
			}
			if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
				void event.data.arrayBuffer().then(handleBinary)
				return
			}
			if (typeof event.data !== 'string') return

			let parsed: { type?: string; code?: string; message?: string }
			try {
				parsed = JSON.parse(event.data) as { type?: string; code?: string; message?: string }
			} catch {
				return
			}

			if (parsed.type === 'started') {
				started = true
				settleStart()
				return
			}

			if (parsed.type === 'stopped') {
				closed = true
				if (stopping) {
					finishStop()
				} else if (started) {
					notifyEnded()
				}
				try {
					socket.close(1000, 'stopped')
				} catch {}
				return
			}

			if (parsed.type === 'error') {
				const err = new AudioHelperError(
					normalizeErrorCode(parsed.code),
					parsed.message || 'Mico Helper could not capture audio.',
				)
				if (!started) {
					closed = true
					settleStart(err)
					try {
						socket.close()
					} catch {}
					return
				}
				closed = true
				if (stopping) finishStop()
				else notifyEnded(err)
				try {
					socket.close()
				} catch {}
			}
		})

		socket.addEventListener('error', () => {
			if (!started) {
				closed = true
				settleStart(new AudioHelperError('connection', 'Could not connect to Mico Helper.'))
			}
		})

		socket.addEventListener('close', () => {
			closed = true
			if (!started) {
				settleStart(new AudioHelperError('connection', 'Mico Helper closed the audio connection.'))
				return
			}
			if (stopping) {
				finishStop()
				return
			}
			notifyEnded()
		})
	})

	return { stop }
}
