import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import WebSocket from 'ws'
import manifest from '../../package.json' with { type: 'json' }
import { createDaemon, type Daemon } from './index.ts'

const ORIGIN = 'https://mico.test'
const HOST = 'mico.test'
const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const CLIENT_ID = '22222222-2222-2222-2222-222222222222'
const ALLOWED_OID = '33333333-3333-3333-3333-333333333333'

async function signToken(
	privateKey: CryptoKey,
	overrides: {
		audience?: string
		issuer?: string
		tenantId?: string
		objectId?: string
		expiresAt?: number
		algorithm?: 'RS256' | 'HS256'
	} = {},
): Promise<string> {
	const expiresAt = overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 300
	return new SignJWT({
		tid: overrides.tenantId ?? TENANT_ID,
		oid: overrides.objectId ?? ALLOWED_OID,
		name: 'Integration User',
	})
		.setProtectedHeader({ alg: overrides.algorithm ?? 'RS256', kid: 'integration-key' })
		.setIssuer(overrides.issuer ?? `https://login.microsoftonline.com/${TENANT_ID}/v2.0`)
		.setAudience(overrides.audience ?? CLIENT_ID)
		.setIssuedAt()
		.setExpirationTime(expiresAt)
		.sign(privateKey)
}

interface HttpResult {
	status: number
	headers: Record<string, string | string[] | undefined>
	body: string
}

function httpRequest(
	port: number,
	path: string,
	options: {
		method?: string
		host?: string
		origin?: string
		cookie?: string
		contentType?: string
		body?: string
	} = {},
): Promise<HttpResult> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path,
				method: options.method ?? 'GET',
				headers: {
					host: options.host ?? `127.0.0.1:${port}`,
					...(options.origin ? { origin: options.origin } : {}),
					...(options.cookie ? { cookie: options.cookie } : {}),
					...(options.contentType ? { 'content-type': options.contentType } : {}),
				},
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk: Buffer) => chunks.push(chunk))
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString('utf8'),
					}),
				)
			},
		)
		req.on('error', reject)
		if (options.body !== undefined) req.write(options.body)
		req.end()
	})
}

function cookieFrom(result: HttpResult): string {
	const setCookie = result.headers['set-cookie']
	const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
	return value?.split(';', 1)[0] ?? ''
}

async function withHostedDaemon(
	run: (context: {
		daemon: Daemon
		port: number
		privateKey: CryptoKey
		staticDir: string
		directory: string
	}) => Promise<void>,
	envOverrides: NodeJS.ProcessEnv = {},
): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-auth-'))
	const staticDir = join(directory, 'dist')
	mkdirSync(join(staticDir, 'assets'), { recursive: true })
	writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Mico</title>')
	writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log("mico")')
	const keyPair = await generateKeyPair('RS256')
	const publicJwk = await exportJWK(keyPair.publicKey)
	publicJwk.kid = 'integration-key'
	publicJwk.alg = 'RS256'
	publicJwk.use = 'sig'
	const jwksResolver = createLocalJWKSet({ keys: [publicJwk] })
	let daemon: Daemon | undefined
	try {
		daemon = createDaemon({
			port: 0,
			dbPath: join(directory, 'board.sqlite'),
			settingsPath: join(directory, 'ai-settings.json'),
			staticDir,
			authJwksResolver: jwksResolver,
			env: {
				MICO_AUTH_MODE: 'entra',
				MICO_PUBLIC_ORIGIN: ORIGIN,
				MICO_AUTH_TENANT_ID: TENANT_ID,
				MICO_AUTH_CLIENT_ID: CLIENT_ID,
				MICO_AUTH_ALLOWED_OBJECT_IDS: ALLOWED_OID,
				MICO_AI_ENABLED: 'true',
				...envOverrides,
			},
		})
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		await run({
			daemon,
			port: address.port,
			privateKey: keyPair.privateKey,
			staticDir,
			directory,
		})
	} finally {
		if (daemon) {
			for (const client of daemon.wss.clients) client.terminate()
			await daemon.close()
		}
		rmSync(directory, { recursive: true, force: true })
	}
}

test('hosted auth verifies Entra claims, uses opaque sessions and returns 204 for session/logout', async () => {
	await withHostedDaemon(async ({ port, privateKey }) => {
		const runtime = await httpRequest(port, '/api/runtime', { host: HOST, origin: ORIGIN })
		assert.equal(runtime.status, 200)
		assert.equal(runtime.headers['cache-control'], 'no-store')
		assert.deepEqual(JSON.parse(runtime.body), {
			auth: {
				mode: 'entra',
				clientId: CLIENT_ID,
				tenantId: TENANT_ID,
				authority: `https://login.microsoftonline.com/${TENANT_ID}`,
				redirectUri: `${ORIGIN}/auth/callback`,
			},
			aiEnabled: true,
			ephemeral: false,
		})

		const unauth = await httpRequest(port, '/api/auth/session', { host: HOST, origin: ORIGIN })
		assert.equal(unauth.status, 401)
		assert.equal(unauth.headers['cache-control'], 'no-store')

		const login = await httpRequest(port, '/login', { host: HOST })
		assert.equal(login.status, 200)
		assert.match(login.body, /Mico/)
		const callback = await httpRequest(port, '/auth/callback', { host: HOST })
		assert.equal(callback.status, 200)
		const asset = await httpRequest(port, '/assets/app.js', { host: HOST })
		assert.equal(asset.status, 200)
		const protectedPage = await httpRequest(port, '/canvas', { host: HOST })
		assert.equal(protectedPage.status, 302)
		assert.equal(protectedPage.headers.location, '/login')

		const forgery = await httpRequest(port, '/api/auth/session', {
			method: 'POST',
			host: HOST,
			origin: 'https://evil.test',
			contentType: 'application/json',
			body: JSON.stringify({ id_token: 'forged' }),
		})
		assert.equal(forgery.status, 403)

		const wrongAudience = await signToken(privateKey, {
			audience: '44444444-4444-4444-4444-444444444444',
		})
		const rejectedAudience = await httpRequest(port, '/api/auth/session', {
			method: 'POST',
			host: HOST,
			origin: ORIGIN,
			contentType: 'application/json',
			body: JSON.stringify({ id_token: wrongAudience }),
		})
		assert.equal(rejectedAudience.status, 401)

		for (const token of [
			await signToken(privateKey, { issuer: 'https://evil.test/v2.0' }),
			await signToken(privateKey, { tenantId: '55555555-5555-5555-5555-555555555555' }),
			await signToken(privateKey, { objectId: '66666666-6666-6666-6666-666666666666' }),
			await signToken(privateKey, { expiresAt: Math.floor(Date.now() / 1000) - 60 }),
		]) {
			const rejected = await httpRequest(port, '/api/auth/session', {
				method: 'POST',
				host: HOST,
				origin: ORIGIN,
				contentType: 'application/json',
				body: JSON.stringify({ id_token: token }),
			})
			assert.equal(rejected.status, 401)
		}

		const idToken = await signToken(privateKey)
		const posted = await httpRequest(port, '/api/auth/session', {
			method: 'POST',
			host: HOST,
			origin: ORIGIN,
			contentType: 'application/json',
			body: JSON.stringify({ id_token: idToken }),
		})
		assert.equal(posted.status, 204)
		assert.equal(posted.body, '')
		assert.equal(posted.headers['cache-control'], 'no-store')
		const cookie = cookieFrom(posted)
		assert.match(cookie, /^__Host-mico-session=/)

		const session = await httpRequest(port, '/api/auth/session', {
			host: HOST,
			origin: ORIGIN,
			cookie,
		})
		assert.equal(session.status, 200)
		const sessionBody = JSON.parse(session.body) as {
			user: { name: string; expiresAt: number }
		}
		assert.equal(sessionBody.user.name, 'Integration User')
		assert.ok(sessionBody.user.expiresAt > 1_000_000_000_000)

		const socket = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
			headers: { host: HOST, origin: ORIGIN, cookie },
		})
		try {
			const [message] = await once(socket, 'message', { signal: AbortSignal.timeout(10_000) })
			assert.equal(JSON.parse(message.toString()).type, 'snapshot')
			const close = once(socket, 'close', { signal: AbortSignal.timeout(10_000) })
			const loggedOut = await httpRequest(port, '/api/auth/logout', {
				method: 'POST',
				host: HOST,
				origin: ORIGIN,
				cookie,
			})
			assert.equal(loggedOut.status, 204)
			assert.equal(loggedOut.body, '')
			assert.equal(loggedOut.headers['cache-control'], 'no-store')
			assert.match(String(loggedOut.headers['set-cookie']), /Max-Age=0/)
			const [, closeReason] = await close
			assert.equal(closeReason.toString(), 'Session revoked')
		} finally {
			socket.terminate()
		}

		const expiredToken = await signToken(privateKey, {
			expiresAt: Math.floor(Date.now() / 1000) + 2,
		})
		const expiredPost = await httpRequest(port, '/api/auth/session', {
			method: 'POST',
			host: HOST,
			origin: ORIGIN,
			contentType: 'application/json',
			body: JSON.stringify({ id_token: expiredToken }),
		})
		assert.equal(expiredPost.status, 204)
		const expiredCookie = cookieFrom(expiredPost)
		const expiredSocket = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
			headers: { host: HOST, origin: ORIGIN, cookie: expiredCookie },
		})
		const expiredClose = once(expiredSocket, 'close', { signal: AbortSignal.timeout(10_000) })
		await once(expiredSocket, 'message', { signal: AbortSignal.timeout(10_000) })
		const [, expiredCloseReason] = await expiredClose
		assert.equal(expiredCloseReason.toString(), 'Session revoked')
		const expiredSession = await httpRequest(port, '/api/auth/session', {
			host: HOST,
			origin: ORIGIN,
			cookie: expiredCookie,
		})
		assert.equal(expiredSession.status, 401)

		const health = await httpRequest(port, '/api/live', { host: `localhost:${port}` })
		assert.equal(health.status, 200)
		assert.deepEqual(JSON.parse(health.body), { status: 'ok', version: manifest.version })
		const internalApi = await httpRequest(port, '/api/state', { host: `127.0.0.1:${port}` })
		assert.equal(internalApi.status, 403)
	})
})

test('AI-disabled daemon blocks every AI route and provider-backed WebSocket without credentials', async () => {
	await withHostedDaemon(
		async ({ port }) => {
			const settings = await httpRequest(port, '/api/ai/settings', {
				host: `127.0.0.1:${port}`,
			})
			assert.equal(settings.status, 200)
			assert.deepEqual(JSON.parse(settings.body), {
				baseURL: '',
				model: '',
				hasApiKey: false,
				readOnly: true,
			})

			for (const [path, method, body] of [
				['/api/ai/models', 'GET', undefined],
				['/api/ai/chat', 'POST', JSON.stringify({ messages: [], selection: [] })],
				['/api/moss/session', 'POST', '{}'],
				['/api/moss/tool', 'POST', '{}'],
				['/mai/config', 'GET', undefined],
			] as const) {
				const response = await httpRequest(port, path, {
					method,
					host: `127.0.0.1:${port}`,
					...(body ? { contentType: 'application/json', body } : {}),
				})
				assert.equal(response.status, 503)
				assert.equal(JSON.parse(response.body).error, 'AI_DISABLED')
			}

			for (const path of ['/mai/realtime', '/moss']) {
				await new Promise<void>((resolve, reject) => {
					const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
						headers: { host: `127.0.0.1:${port}` },
					})
					const timeout = setTimeout(
						() => reject(new Error(`Timed out waiting for ${path}`)),
						10_000,
					)
					socket.once('unexpected-response', (_req, res) => {
						clearTimeout(timeout)
						assert.equal(res.statusCode, 503)
						resolve()
					})
					socket.once('error', () => {})
					socket.once('open', () => {
						clearTimeout(timeout)
						socket.terminate()
						reject(new Error(`${path} unexpectedly opened`))
					})
				})
			}
		},
		{
			MICO_AI_ENABLED: 'false',
			MICO_RUNTIME: 'deploy',
			MICO_AUTH_MODE: 'none',
			MICO_PUBLIC_ORIGIN: '',
		},
	)
})
