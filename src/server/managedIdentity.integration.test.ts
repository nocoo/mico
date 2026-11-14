import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TokenCredential } from '@azure/identity'
import WebSocket, { WebSocketServer } from 'ws'
import { createDaemon } from './index.ts'
import { createMaiProxy, MAI_LOCAL_PATH } from './maiProxy.ts'
import { createManagedIdentityAuth } from './managedIdentity.ts'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

class MockCredential implements TokenCredential {
	readonly requestedScopes: string[][] = []

	async getToken(scopes: string | string[]) {
		const normalized = typeof scopes === 'string' ? [scopes] : scopes
		this.requestedScopes.push(normalized)
		return {
			token: `mock-${normalized[0].includes('cognitiveservices') ? 'mai' : 'chat'}`,
			expiresOnTimestamp: Date.now() + 3_600_000,
		}
	}
}

async function closeHttpDaemon(daemon: ReturnType<typeof createDaemon>): Promise<void> {
	await daemon.close()
}

test('Managed Identity providers use SDK bearer caching for the Foundry audience', async () => {
	const credential = new MockCredential()
	const auth = createManagedIdentityAuth(CLIENT_ID, credential)
	assert.equal(await auth.chatBearer(), 'mock-chat')
	assert.equal(await auth.chatBearer(), 'mock-chat')
	assert.equal(await auth.maiBearer(), 'mock-chat')
	assert.equal(await auth.maiBearer(), 'mock-chat')
	assert.equal(credential.requestedScopes.length, 1)
	assert.ok(
		credential.requestedScopes.some((scopes) => scopes[0] === 'https://ai.azure.com/.default'),
	)
})

test('MAI queues session.update before async bearer retrieval and forwards Authorization', async () => {
	const upstreamServer = new WebSocketServer({ port: 0, host: '127.0.0.1' })
	await new Promise<void>((resolve, reject) => {
		upstreamServer.once('listening', resolve)
		upstreamServer.once('error', reject)
	})
	const upstreamAddress = upstreamServer.address() as AddressInfo
	let bearerCalls = 0
	let releaseBearer: (token: string) => void = () => {}
	const bearer = new Promise<string>((resolve) => {
		releaseBearer = resolve
	})
	let upstreamAuthorization: string | undefined
	const httpServer = createServer()
	await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
	const address = httpServer.address() as AddressInfo
	const allowedOrigin = `http://127.0.0.1:${address.port}`
	const proxy = createMaiProxy({
		host: 'resource.services.ai.azure.com',
		apiKey: '',
		deployment: 'voice-deployment',
		allowedOrigin,
		bearerProvider: async () => {
			bearerCalls++
			return bearer
		},
		onConnection: (_request, client) => {
			client.once('message', () => releaseBearer('fresh-token'))
		},
		createUpstream(url, options) {
			upstreamAuthorization =
				'Authorization' in options.headers ? options.headers.Authorization : undefined
			assert.equal(url, 'wss://resource.services.ai.azure.com/mai/v1/realtime?intent=transcription')
			return new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`)
		},
	})
	httpServer.on('upgrade', proxy.upgrade)
	const peerConnected = once(upstreamServer, 'connection', { signal: AbortSignal.timeout(5000) })
	const client = new WebSocket(`ws://127.0.0.1:${address.port}${MAI_LOCAL_PATH}`, {
		origin: `http://127.0.0.1:${address.port}`,
	})
	try {
		await once(client, 'open', { signal: AbortSignal.timeout(5000) })
		const sessionUpdate = JSON.stringify({
			type: 'session.update',
			session: {
				type: 'transcription',
				audio: { input: { format: { type: 'audio/pcm', rate: 16000 } } },
			},
		})
		client.send(sessionUpdate)
		const [peer] = (await peerConnected) as [WebSocket, unknown]
		const [forwarded] = await once(peer, 'message', { signal: AbortSignal.timeout(5000) })
		assert.equal(forwarded.toString(), sessionUpdate)
		assert.equal(bearerCalls, 1)
		assert.equal(upstreamAuthorization, 'Bearer fresh-token')
	} finally {
		client.on('error', () => {})
		client.terminate()
		proxy.close()
		await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		for (const peer of upstreamServer.clients) peer.terminate()
		await new Promise<void>((resolve) => upstreamServer.close(() => resolve()))
	}
})

test('MAI closes a bounded pre-auth queue and never connects after client cancellation', async () => {
	let release: (token: string) => void = () => {}
	const bearer = new Promise<string>((resolve) => {
		release = resolve
	})
	let upstreams = 0
	const server = createServer()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = (server.address() as AddressInfo).port
	const origin = `http://127.0.0.1:${port}`
	const proxy = createMaiProxy({
		host: 'resource.services.ai.azure.com',
		apiKey: '',
		deployment: 'speech',
		allowedOrigin: origin,
		maxBacklogFrames: 1,
		bearerProvider: () => bearer,
		createUpstream() {
			upstreams++
			throw new Error('Unexpected upstream')
		},
	})
	server.on('upgrade', proxy.upgrade)
	const client = new WebSocket(`ws://127.0.0.1:${port}/mai/realtime`, { origin })
	client.on('error', () => {})
	try {
		await once(client, 'open', { signal: AbortSignal.timeout(5000) })
		const closed = once(client, 'close', { signal: AbortSignal.timeout(5000) })
		client.send('{"type":"session.update"}')
		client.send('{"type":"input_audio_buffer.append"}')
		const [code] = await closed
		assert.equal(code, 1013)
		release('late-token')
		await bearer
		await new Promise<void>((resolve) => setImmediate(resolve))
		assert.equal(upstreams, 0)
	} finally {
		client.terminate()
		proxy.close()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
})

test('real daemon Chat and model routes use managed bearer credentials, not saved keys', async (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-managed-http-'))
	const settingsPath = join(directory, 'settings.json')
	const saved = JSON.stringify({
		baseURL: 'https://stale.example/v1',
		model: 'stale',
		apiKey: 'stale-secret',
	})
	writeFileSync(settingsPath, saved)
	const originalFetch = globalThis.fetch
	const outbound: string[] = []
	t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		if (url.hostname !== 'resource.services.ai.azure.com') return originalFetch(input, init)
		outbound.push(url.pathname)
		const headers = new Headers(init?.headers)
		assert.equal(headers.get('Authorization'), 'Bearer mock-chat')
		assert.equal(headers.get('api-key'), null)
		assert.equal(init?.redirect, 'manual')
		if (url.pathname === '/openai/v1/models')
			return Response.json({ data: [{ id: 'chat-deployment' }] })
		assert.equal(url.pathname, '/openai/v1/chat/completions')
		const body = JSON.parse(String(init?.body))
		assert.equal(body.model, 'chat-deployment')
		assert.equal(body.reasoning_effort, 'low')
		assert.ok(
			body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'get_board'),
		)
		const events = [
			{
				id: 'fixture',
				object: 'chat.completion.chunk',
				created: 1,
				model: 'chat-deployment',
				choices: [
					{
						index: 0,
						delta: { role: 'assistant', content: 'Managed identity ready' },
						finish_reason: null,
					},
				],
			},
			{
				id: 'fixture',
				object: 'chat.completion.chunk',
				created: 1,
				model: 'chat-deployment',
				choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
				usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
			},
		]
		return new Response(
			`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
			{ headers: { 'Content-Type': 'text/event-stream' } },
		)
	})
	const credential = new MockCredential()
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath,
		managedIdentityCredential: credential,
		env: {
			MICO_RUNTIME: 'laptop',
			MICO_AI_AUTH_MODE: 'managed-identity',
			AZURE_CLIENT_ID: CLIENT_ID,
			MICO_MOSS_ENABLED: 'false',
			MAGPIE_BASE_URL: 'https://resource.services.ai.azure.com/openai/v1',
			MAGPIE_MODEL: 'chat-deployment',
			MAGPIE_LECTURE_REASONING: 'low',
		},
	})
	try {
		await new Promise<void>((resolve) => daemon.server.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${(daemon.server.address() as AddressInfo).port}`
		const settings = await (await originalFetch(`${url}/api/ai/settings`)).json()
		assert.deepEqual(settings, {
			baseURL: 'https://resource.services.ai.azure.com/openai/v1',
			model: 'chat-deployment',
			hasApiKey: false,
			authMode: 'managed-identity',
			readOnly: true,
		})
		const models = await originalFetch(`${url}/api/ai/models`)
		assert.deepEqual(await models.json(), { models: ['chat-deployment'] })
		const chat = await originalFetch(`${url}/api/ai/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				mode: 'lecture',
				messages: [
					{ id: 'mi-user', role: 'user', parts: [{ type: 'text', text: 'Draw a short label.' }] },
				],
			}),
		})
		assert.equal(chat.status, 200)
		assert.match(await chat.text(), /Managed identity ready/)
		assert.deepEqual(outbound, ['/openai/v1/models', '/openai/v1/chat/completions'])
		assert.equal(credential.requestedScopes.length, 1)
		assert.equal(readFileSync(settingsPath, 'utf8'), saved)
	} finally {
		await daemon.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('MOSS-disabled daemon routes keep AI-disabled precedence and never construct MOSS', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-managed-moss-'))
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'settings.json'),
		env: {
			MICO_RUNTIME: 'deploy',
			MICO_AI_ENABLED: 'true',
			MICO_AI_AUTH_MODE: 'managed-identity',
			AZURE_CLIENT_ID: CLIENT_ID,
			MICO_MOSS_ENABLED: 'false',
			MAGPIE_BASE_URL: 'https://resource.services.ai.azure.com/openai/v1',
			MAGPIE_MODEL: 'chat-deployment',
			AZURE_MAI_HOST: 'resource.services.ai.azure.com',
			AZURE_OPENAI_DEPLOYMENT: 'voice-deployment',
		},
		managedIdentityCredential: new MockCredential(),
		createMossUpstream() {
			throw new Error('MOSS upstream must not be constructed')
		},
	})
	await new Promise<void>((resolve) => daemon.server.listen(0, '127.0.0.1', resolve))
	const address = daemon.server.address() as AddressInfo
	try {
		for (const path of ['/api/moss/session', '/api/moss/tool']) {
			const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			})
			assert.equal(response.status, 503)
			assert.deepEqual(await response.json(), {
				error: 'MOSS_DISABLED',
				message: 'MOSS Live is disabled',
			})
		}
	} finally {
		await closeHttpDaemon(daemon)
		rmSync(directory, { recursive: true, force: true })
	}
})
