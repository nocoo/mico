import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
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
			expiresOnTimestamp: Date.now() + 60_000,
		}
	}
}

async function closeHttpDaemon(daemon: ReturnType<typeof createDaemon>): Promise<void> {
	await daemon.close()
}

test('Managed Identity providers use SDK bearer caching and separate scopes', async () => {
	const credential = new MockCredential()
	const auth = createManagedIdentityAuth(CLIENT_ID, credential)
	assert.equal(await auth.chatBearer(), 'mock-chat')
	assert.equal(await auth.chatBearer(), 'mock-chat')
	assert.equal(await auth.maiBearer(), 'mock-mai')
	assert.equal(await auth.maiBearer(), 'mock-mai')
	assert.ok(
		credential.requestedScopes.some((scopes) => scopes[0] === 'https://ai.azure.com/.default'),
	)
	assert.ok(
		credential.requestedScopes.some(
			(scopes) => scopes[0] === 'https://cognitiveservices.azure.com/.default',
		),
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
			await new Promise((resolve) => setTimeout(resolve, 20))
			return 'fresh-token'
		},
		createUpstream(url, options) {
			upstreamAuthorization =
				'Authorization' in options.headers ? options.headers.Authorization : undefined
			assert.equal(url, 'wss://resource.services.ai.azure.com/mai/v1/realtime?intent=transcription')
			return new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`)
		},
	})
	httpServer.on('upgrade', proxy.upgrade)
	const peerConnected = new Promise<WebSocket>((resolve) => {
		upstreamServer.once('connection', resolve)
	})
	const client = new WebSocket(`ws://127.0.0.1:${address.port}${MAI_LOCAL_PATH}`, {
		origin: `http://127.0.0.1:${address.port}`,
	})
	try {
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => reject(error)
			client.once('error', onError)
			client.once('open', () => {
				client.off('error', onError)
				resolve()
			})
		})
		const sessionUpdate = JSON.stringify({
			type: 'session.update',
			session: {
				type: 'transcription',
				audio: { input: { format: { type: 'audio/pcm', rate: 16000 } } },
			},
		})
		client.send(sessionUpdate)
		const peer = await peerConnected
		const forwarded = await new Promise<string>((resolve, reject) => {
			peer.once('message', (data) => resolve(data.toString()))
			peer.once('error', reject)
		})
		assert.equal(forwarded, sessionUpdate)
		assert.equal(bearerCalls, 1)
		assert.equal(upstreamAuthorization, 'Bearer fresh-token')
	} finally {
		client.removeAllListeners('error')
		client.terminate()
		proxy.close()
		await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		for (const peer of upstreamServer.clients) peer.terminate()
		await new Promise<void>((resolve) => upstreamServer.close(() => resolve()))
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
			AZURE_MAI_ENDPOINT: 'https://resource.services.ai.azure.com',
			AZURE_MAI_DEPLOYMENT_NAME: 'voice-deployment',
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
