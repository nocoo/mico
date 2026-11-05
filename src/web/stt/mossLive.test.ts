import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	type MossLiveEvent,
	MossLiveSession,
	setMossLiveCaptureFactoryForTests,
} from './mossLive.ts'

class MockSocket {
	static readonly CONNECTING = 0
	static readonly OPEN = 1
	static instances: MockSocket[] = []
	readonly sent: unknown[] = []
	readyState = MockSocket.OPEN
	bufferedAmount = 0
	binaryType = 'blob'
	onmessage: ((event: { data: unknown }) => void) | null = null
	onerror: (() => void) | null = null
	onclose: (() => void) | null = null
	closeCalls = 0

	constructor(_url: string) {
		MockSocket.instances.push(this)
	}

	send(message: unknown): void {
		this.sent.push(message)
	}

	close(): void {
		this.closeCalls++
		this.readyState = 3
	}

	dispatchJson(message: Record<string, unknown>): void {
		this.onmessage?.({ data: JSON.stringify(message) })
	}

	dispatchBinary(message: ArrayBuffer): void {
		this.onmessage?.({ data: message })
	}
}

class MockOutputContext {
	readonly currentTime = 0
	readonly destination = {}
	closeCalls = 0
	resumeCalls = 0

	resume(): Promise<void> {
		this.resumeCalls++
		return Promise.resolve()
	}

	close(): Promise<void> {
		this.closeCalls++
		return Promise.resolve()
	}

	createBuffer(_channels: number, length: number, rate: number): AudioBuffer {
		return {
			duration: length / rate,
			getChannelData: () => new Float32Array(length),
		} as unknown as AudioBuffer
	}

	createBufferSource(): AudioBufferSourceNode {
		return {
			buffer: undefined,
			connect() {},
			start() {},
			stop() {},
			disconnect() {},
			onended: null,
		} as unknown as AudioBufferSourceNode
	}
}

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	} as Response
}

function installGlobals(fetchImpl: typeof fetch): {
	contexts: MockOutputContext[]
} {
	MockSocket.instances = []
	const contexts: MockOutputContext[] = []
	Object.defineProperty(globalThis, 'location', {
		configurable: true,
		value: { protocol: 'http:', host: 'localhost' },
	})
	Object.defineProperty(globalThis, 'WebSocket', {
		configurable: true,
		value: MockSocket,
	})
	Object.defineProperty(globalThis, 'AudioContext', {
		configurable: true,
		value: function MockAudioContext() {
			const context = new MockOutputContext()
			contexts.push(context)
			return context
		},
	})
	Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchImpl })
	return { contexts }
}

function cleanupGlobals(): void {
	setMossLiveCaptureFactoryForTests(null)
	delete (globalThis as { location?: Location }).location
	delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
	delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
	delete (globalThis as { fetch?: typeof fetch }).fetch
}

async function flush(): Promise<void> {
	await Promise.resolve()
	await new Promise((resolve) => setTimeout(resolve, 0))
}

test('connects, emits real PCM waveform, registers tools, and serializes canvas revisions', async () => {
	let pcm: ((pcm: Int16Array) => void) | null = null
	let stopCalls = 0
	setMossLiveCaptureFactoryForTests(async (onPcm, _onEnded) => {
		pcm = onPcm
		return {
			stop: async () => {
				stopCalls++
			},
		}
	})

	const toolRequests: Array<Record<string, unknown>> = []
	const toolBodies: Array<{ result: unknown; revision: number }> = []
	const fetchImpl = async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const url = typeof input === 'string' ? input : input.toString()
		if (url === '/api/moss/session') {
			return jsonResponse({
				canvasId: 'canvas-1',
				revision: 1,
				instructions: 'Use the canvas tools.',
				tools: [
					{
						type: 'function',
						name: 'set_title',
						description: 'Set title',
						parameters: { type: 'object' },
					},
				],
			})
		}
		if (url === '/api/moss/tool') {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>
			toolRequests.push(body)
			const revision = Number(body.revision) + 1
			if ((body.input as Record<string, unknown>)?.title === 'C') {
				const result = {
					ok: false,
					error: 'TITLE_CONFLICT',
					message: 'Mock title conflict',
					revision,
				}
				toolBodies.push({ result, revision })
				return jsonResponse({ result, revision })
			}
			const result = { success: true, revision }
			toolBodies.push({ result, revision })
			return jsonResponse({ result, revision })
		}
		throw new Error(`Unexpected fetch: ${url}`)
	}
	const { contexts } = installGlobals(fetchImpl as typeof fetch)
	const events: MossLiveEvent[] = []
	const session = new MossLiveSession({
		canvasId: 'canvas-1',
		selection: ['card-1'],
		onEvent: (event) => events.push(event),
	})

	try {
		await session.start()
		assert.equal(contexts[0].resumeCalls, 1)
		const socket = MockSocket.instances[0]
		socket.dispatchJson({ action: 'proxy.ready' })
		assert.deepEqual(JSON.parse(String(socket.sent.at(-1))), {
			action: 'attach_session',
			delegation: 'client',
		})

		socket.dispatchJson({ action: 'session_attached', data: { delegation: 'client' } })
		const update = JSON.parse(String(socket.sent.at(-1))) as Record<string, unknown>
		assert.equal((update.session as Record<string, unknown>).instructions, 'Use the canvas tools.')

		socket.dispatchJson({ action: 'session.updated', data: { tools: ['set_title'] } })
		assert.deepEqual(events.at(-1), { type: 'status', phase: 'listening' })

		const samples = new Int16Array(1600)
		for (let index = 0; index < samples.length; index++)
			samples[index] = index % 2 === 0 ? -32768 : 16384
		;(pcm as ((pcm: Int16Array) => void) | null)?.(samples)
		assert.deepEqual(events.at(-1), { type: 'audio', min: -1, max: 16384 / 32768 })
		const packets = socket.sent.filter((message) => message instanceof ArrayBuffer)
		assert.equal(packets.length, 5)
		assert.equal(
			packets.every((message) => (message as ArrayBuffer).byteLength === 640),
			true,
		)
		const firstPacket = new DataView(packets[0] as ArrayBuffer)
		assert.equal(firstPacket.getInt16(0, true), -32768)
		assert.equal(firstPacket.getInt16(2, true), 16384)

		socket.dispatchJson({
			action: 'response.function_call_arguments.done',
			data: { call_id: 'call-1', name: 'set_title', arguments: '{"title":"A"}' },
		})
		socket.dispatchJson({
			action: 'response.function_call_arguments.done',
			data: { call_id: 'call-1', name: 'set_title', arguments: '{"title":"A"}' },
		})
		await flush()

		assert.equal(toolRequests.length, 1)
		assert.equal(toolRequests[0].revision, 1)
		assert.deepEqual(
			events.filter((event) => event.type === 'tool'),
			[
				{ type: 'tool', name: 'set_title', phase: 'started' },
				{ type: 'tool', name: 'set_title', phase: 'done' },
			],
		)
		const resultOutput = socket.sent.find((message) => {
			if (!(typeof message === 'string')) return false
			const parsed = JSON.parse(message) as Record<string, unknown>
			return parsed.action === 'conversation.item.create'
		})
		assert.ok(resultOutput)

		socket.dispatchJson({
			action: 'response.function_call_arguments.done',
			data: { call_id: 'call-2', name: 'set_title', arguments: '{"title":"B"}' },
		})
		await flush()
		assert.equal(toolRequests.length, 2)
		assert.equal(toolRequests[1].revision, 2)

		socket.dispatchJson({
			action: 'response.function_call_arguments.done',
			data: { call_id: 'call-3', name: 'set_title', arguments: '{"title":"C"}' },
		})
		await flush()
		assert.equal(toolRequests.length, 3)
		assert.equal(toolRequests[2].revision, 3)
		assert.ok(
			events.some(
				(event) => event.type === 'tool' && event.name === 'set_title' && event.phase === 'error',
			),
		)
		const outputs = socket.sent
			.filter((message): message is string => typeof message === 'string')
			.map((message) => JSON.parse(message) as Record<string, unknown>)
			.filter((message) => message.action === 'conversation.item.create')
			.map((message) => (message.item as Record<string, unknown>).output)
		assert.equal(
			outputs.at(-1),
			JSON.stringify({
				ok: false,
				error: 'TITLE_CONFLICT',
				message: 'Mock title conflict',
				revision: 4,
			}),
		)

		socket.dispatchJson({
			action: 'response.ended',
			data: {
				status: 'failed',
				status_details: { error: { message: 'Turn retryable failure' } },
				run_id: 'run-1',
				turn_id: 'turn-1',
			},
		})
		assert.deepEqual(events.at(-1), {
			type: 'warning',
			message: 'Turn retryable failure (run: run-1, turn: turn-1)',
		})
		assert.equal(socket.closeCalls, 0)

		session.stop()
		assert.equal(stopCalls, 1)
		assert.deepEqual(events.at(-1), { type: 'status', phase: 'idle' })
	} finally {
		cleanupGlobals()
	}
})

test('tool cancellation aborts the request and sends no late result', async () => {
	let resolveTool: ((response: Response) => void) | null = null
	let aborted = false
	setMossLiveCaptureFactoryForTests(async (onPcm) => ({
		stop: async () => {},
	}))
	const fetchImpl = async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const url = typeof input === 'string' ? input : input.toString()
		if (url === '/api/moss/session') {
			return jsonResponse({
				canvasId: 'canvas-1',
				revision: 1,
				instructions: '',
				tools: [{ name: 'slow_tool' }],
			})
		}
		if (url === '/api/moss/tool') {
			init?.signal?.addEventListener('abort', () => {
				aborted = true
			})
			return await new Promise<Response>((resolve) => {
				resolveTool = resolve
			})
		}
		throw new Error(`Unexpected fetch: ${url}`)
	}
	installGlobals(fetchImpl as typeof fetch)
	const events: MossLiveEvent[] = []
	const session = new MossLiveSession({
		canvasId: 'canvas-1',
		selection: [],
		onEvent: (event) => events.push(event),
	})

	try {
		await session.start()
		const socket = MockSocket.instances[0]
		socket.dispatchJson({ action: 'proxy.ready' })
		socket.dispatchJson({ action: 'session_attached', data: { delegation: 'client' } })
		socket.dispatchJson({ action: 'session.updated', data: { tools: ['slow_tool'] } })
		socket.dispatchJson({
			action: 'response.function_call_arguments.done',
			data: { call_id: 'slow-1', name: 'slow_tool', arguments: '{}' },
		})
		await flush()
		session.stop()
		await flush()
		assert.equal(aborted, true)
		assert.equal(
			socket.sent.some(
				(message) =>
					typeof message === 'string' && String(message).includes('function_call_output'),
			),
			false,
		)
		assert.equal(events.filter((event) => event.type === 'tool').length, 1)
	} finally {
		cleanupGlobals()
	}
})

test('audio backpressure closes the session', async () => {
	let pcm: ((pcm: Int16Array) => void) | null = null
	setMossLiveCaptureFactoryForTests(async (onPcm) => {
		pcm = onPcm
		return { stop: async () => {} }
	})
	installGlobals(async (input) => {
		const url = typeof input === 'string' ? input : input.toString()
		if (url === '/api/moss/session') {
			return jsonResponse({ canvasId: 'canvas-1', revision: 1, instructions: '', tools: [] })
		}
		throw new Error(`Unexpected fetch: ${url}`)
	})
	const events: MossLiveEvent[] = []
	const session = new MossLiveSession({
		canvasId: 'canvas-1',
		selection: [],
		onEvent: (event) => events.push(event),
	})

	try {
		await session.start()
		const socket = MockSocket.instances[0]
		socket.dispatchJson({ action: 'proxy.ready' })
		socket.dispatchJson({ action: 'session_attached', data: { delegation: 'client' } })
		socket.dispatchJson({ action: 'session.updated', data: { tools: [] } })
		socket.bufferedAmount = 128001
		;(pcm as ((pcm: Int16Array) => void) | null)?.(new Int16Array([1000, -1000]))
		assert.deepEqual(events.at(-2), {
			type: 'error',
			message: 'Network congestion stopped audio sending.',
		})
		assert.deepEqual(events.at(-1), { type: 'status', phase: 'idle' })
	} finally {
		cleanupGlobals()
	}
})

test('permission denial closes the session', async () => {
	setMossLiveCaptureFactoryForTests(async () => {
		throw new DOMException('Denied', 'NotAllowedError')
	})
	installGlobals(async () =>
		jsonResponse({ canvasId: 'canvas-1', revision: 1, instructions: '', tools: [] }),
	)
	const events: MossLiveEvent[] = []
	const session = new MossLiveSession({
		canvasId: 'canvas-1',
		selection: [],
		onEvent: (event) => events.push(event),
	})

	try {
		await session.start()
		assert.deepEqual(events.at(-2), {
			type: 'error',
			message: 'Microphone permission is required to start.',
		})
		assert.deepEqual(events.at(-1), { type: 'status', phase: 'idle' })
	} finally {
		cleanupGlobals()
	}
})
