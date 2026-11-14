import { readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TokenCredential } from '@azure/identity'
import type { LanguageModel } from 'ai'
import type { JWTVerifyGetKey } from 'jose'
import serveStatic from 'serve-static'
import WebSocket, { WebSocketServer } from 'ws'
import manifest from '../../package.json' with { type: 'json' }
import { ALLOWED_ORIGINS, DAEMON_PORT } from '../shared/config.ts'
import { loadRuntimeConfig, publicRuntimeContract, type RuntimeConfig } from '../shared/runtime.ts'
import { createMagpieModel, fetchAiModels, parseAiChatRequest, streamAiChat } from './ai.ts'
import { type ChatSettings, loadAiConfig, loadRuntimeEnv } from './aiConfig.ts'
import { AI_SETTINGS_PATH, AiSettingsStore } from './aiSettings.ts'
import { AuthManager } from './auth.ts'
import { ImageGenerationService, type ImageGenerator } from './imageGeneration.ts'
import {
	createMaiProxy,
	MAI_CONFIG_PATH,
	MAI_LOCAL_PATH,
	type MaiProxyOptions,
} from './maiProxy.ts'
import { createManagedIdentityAuth } from './managedIdentity.ts'
import { createMossSession, executeMossTool } from './mossApi.ts'
import { createMossProxy, MOSS_LOCAL_PATH, type MossRealtimeProxyOptions } from './mossProxy.ts'
import { parseRequestTarget } from './requestTarget.ts'
import { BoardStore, LOCAL_TENANT, OperationError, type TenantStore } from './store.ts'
import { tenantScopeFor } from './tenant.ts'

function parsePort(env: NodeJS.ProcessEnv): number {
	const raw = env.MICO_PORT
	if (!raw) return DAEMON_PORT
	const port = Number(raw)
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('MICO_PORT must be an integer from 1 to 65535')
	}
	return port
}

const MAX_JSON_BYTES = 1024 * 1024
const MAX_RESTORE_BYTES = 64 * MAX_JSON_BYTES

function readJson(req: IncomingMessage, allowRestore = false): Promise<unknown> {
	return new Promise((resolveBody, reject) => {
		const chunks: Buffer[] = []
		let size = 0
		let tooLarge = false
		req.on('data', (chunk: Buffer) => {
			if (tooLarge) return
			size += chunk.length
			if (size > (allowRestore ? MAX_RESTORE_BYTES : MAX_JSON_BYTES)) {
				tooLarge = true
				reject(
					new OperationError(
						413,
						'PAYLOAD_TOO_LARGE',
						`Request body exceeds ${allowRestore ? 64 : 1} MB`,
					),
				)
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => {
			if (tooLarge) return
			try {
				const text = Buffer.concat(chunks).toString('utf8')
				const body: unknown = text.length === 0 ? undefined : JSON.parse(text)
				const restore =
					allowRestore &&
					isRecord(body) &&
					Number.isInteger(body.expectedRevision) &&
					Array.isArray(body.operations) &&
					body.operations.some(
						(operation: unknown) => isRecord(operation) && operation.type === 'restore',
					) &&
					body.operations.every(
						(operation: unknown) =>
							isRecord(operation) && (operation.type === 'restore' || operation.type === 'delete'),
					)
				if (size > MAX_JSON_BYTES && !restore) {
					throw new OperationError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB')
				}
				resolveBody(body)
			} catch (error) {
				reject(
					error instanceof OperationError
						? error
						: new OperationError(400, 'INVALID_JSON', 'Request body is not valid JSON'),
				)
			}
		})
		req.on('aborted', () => reject(new OperationError(400, 'REQUEST_ABORTED', 'Request aborted')))
		req.on('error', (error) => reject(error))
	})
}

const MAX_AUTH_JSON_BYTES = 64 * 1024

function readAuthJson(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolveBody, reject) => {
		const chunks: Buffer[] = []
		let size = 0
		let tooLarge = false
		req.on('data', (chunk: Buffer) => {
			if (tooLarge) return
			size += chunk.length
			if (size > MAX_AUTH_JSON_BYTES) {
				tooLarge = true
				reject(new OperationError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 64 KB'))
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => {
			if (tooLarge) return
			try {
				const text = Buffer.concat(chunks).toString('utf8')
				resolveBody(text.length === 0 ? undefined : JSON.parse(text))
			} catch {
				reject(new OperationError(400, 'INVALID_JSON', 'Request body is not valid JSON'))
			}
		})
		req.on('aborted', () => reject(new OperationError(400, 'REQUEST_ABORTED', 'Request aborted')))
		req.on('error', (error) => reject(error))
	})
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function readRaw(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolveBody, reject) => {
		const chunks: Buffer[] = []
		let size = 0
		let tooLarge = false
		req.on('data', (chunk: Buffer) => {
			if (tooLarge) return
			size += chunk.length
			if (size > MAX_IMAGE_BYTES) {
				tooLarge = true
				reject(new OperationError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 10 MB'))
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => {
			if (!tooLarge) resolveBody(Buffer.concat(chunks))
		})
		req.on('aborted', () => reject(new OperationError(400, 'REQUEST_ABORTED', 'Request aborted')))
		req.on('error', (error) => reject(error))
	})
}

function detectImageType(
	bytes: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined {
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	)
		return 'image/png'
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return 'image/jpeg'
	if (
		bytes.length >= 6 &&
		((bytes[0] === 0x47 &&
			bytes[1] === 0x49 &&
			bytes[2] === 0x46 &&
			bytes[3] === 0x38 &&
			bytes[4] === 0x37 &&
			bytes[5] === 0x61) ||
			(bytes[0] === 0x47 &&
				bytes[1] === 0x49 &&
				bytes[2] === 0x46 &&
				bytes[3] === 0x38 &&
				bytes[4] === 0x39 &&
				bytes[5] === 0x61))
	)
		return 'image/gif'
	if (
		bytes.length >= 12 &&
		bytes.toString('ascii', 0, 4) === 'RIFF' &&
		bytes.toString('ascii', 8, 12) === 'WEBP'
	)
		return 'image/webp'
	return undefined
}

function sendJson(res: ServerResponse, status: number, body: unknown, origin?: string): void {
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		res.setHeader('Access-Control-Allow-Origin', origin)
		res.setHeader('Vary', 'Origin')
	}
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
	res.end(JSON.stringify(body))
}

function sendError(
	res: ServerResponse,
	status: number,
	code: string,
	message: string,
	origin?: string,
): void {
	sendJson(res, status, { error: code, message }, origin)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, optional: string[] = []): boolean {
	const allowed = new Set(optional)
	return Object.keys(value).every((key) => allowed.has(key))
}

function invalid(message: string): never {
	throw new OperationError(400, 'INVALID_REQUEST', message)
}

function knownPath(pathname: string): boolean {
	const segments = pathname.split('/').filter(Boolean)
	if (segments[0] !== 'api') return false
	if (segments.length === 2) {
		return [
			'live',
			'runtime',
			'state',
			'board',
			'operations',
			'events',
			'canvases',
			'images',
			'active-canvas',
			'auth',
		].includes(segments[1])
	}
	if (segments.length === 3) {
		return (
			(segments[1] === 'auth' && ['session', 'logout'].includes(segments[2])) ||
			segments[1] === 'canvases' ||
			segments[1] === 'images' ||
			(segments[1] === 'moss' && ['session', 'tool'].includes(segments[2])) ||
			(segments[1] === 'ai' && ['chat', 'models', 'settings'].includes(segments[2]))
		)
	}
	return false
}

export interface Daemon {
	server: ReturnType<typeof createServer>
	runtimeConfig: RuntimeConfig
	boards: BoardStore
	store: TenantStore
	aiSettings: AiSettingsStore
	imageGeneration: ImageGenerationService
	wss: WebSocketServer
	close(): Promise<void>
}

export function createDaemon(
	options: {
		port?: number
		dbPath?: string
		aiModel?: LanguageModel
		settingsPath?: string
		env?: NodeJS.ProcessEnv
		createAiModel?: (settings: ChatSettings) => LanguageModel
		imageGenerator?: ImageGenerator
		staticDir?: string
		authJwksResolver?: JWTVerifyGetKey
		createMaiUpstream?: MaiProxyOptions['createUpstream']
		createMossUpstream?: MossRealtimeProxyOptions['createUpstream']
		managedIdentityCredential?: TokenCredential
	} = {},
): Daemon {
	const env = options.env ?? process.env
	const runtimeConfig = loadRuntimeConfig(env)
	const port = options.port ?? parsePort(env)
	const config = loadAiConfig(env)
	const managedIdentityAuth =
		runtimeConfig.aiEnabled && config.authMode === 'managed-identity'
			? createManagedIdentityAuth(config.azureClientId as string, options.managedIdentityCredential)
			: undefined
	if (options.staticDir && !statSync(resolve(options.staticDir, 'index.html')).isFile()) {
		throw new Error('MICO_STATIC_DIR must contain a built index.html')
	}
	const assets = options.staticDir
		? serveStatic(options.staticDir, {
				etag: true,
				maxAge: 0,
				setHeaders: (res) => {
					res.setHeader('X-Content-Type-Options', 'nosniff')
					if (runtimeConfig.auth.mode === 'entra')
						res.setHeader('Cache-Control', 'private, no-store')
				},
			})
		: undefined
	const mai =
		runtimeConfig.aiEnabled && assets
			? createMaiProxy({
					...config.mai,
					allowedOrigin: runtimeConfig.publicOrigin,
					bearerProvider: managedIdentityAuth?.maiBearer,
					createUpstream: options.createMaiUpstream,
					onConnection: (req, client) => auth.attachSocket(req, client),
				})
			: undefined
	const moss =
		runtimeConfig.aiEnabled && runtimeConfig.mossEnabled && assets
			? createMossProxy({
					enabled: true,
					...config.moss,
					allowedOrigin: runtimeConfig.publicOrigin,
					createUpstream: options.createMossUpstream,
					onConnection: (req, client) => auth.attachSocket(req, client),
				})
			: undefined
	const dbPath = options.dbPath ?? env.MICO_DB_PATH ?? '.mico/board.sqlite'
	const boards = new BoardStore(dbPath)
	const store = boards.forTenant(LOCAL_TENANT)
	const settingsPath = options.settingsPath
	const aiSettings = new AiSettingsStore({
		path: settingsPath ?? AI_SETTINGS_PATH,
		config,
		persist: settingsPath !== undefined || options.aiModel === undefined,
		aiEnabled: runtimeConfig.aiEnabled,
	})
	const aiModel = options.aiModel
	const modelFactory =
		options.createAiModel ??
		((settings: ChatSettings) => createMagpieModel(settings, managedIdentityAuth?.chatBearer))
	const wss = new WebSocketServer({ noServer: true })
	const auth = new AuthManager(runtimeConfig, options.authJwksResolver)

	const socketTenant = new WeakMap<WebSocket, string>()

	const broadcast = (event: unknown, tenantId: string): void => {
		const payload = JSON.stringify(event)
		for (const client of wss.clients) {
			if (client.readyState !== WebSocket.OPEN) continue
			if ((socketTenant.get(client) ?? LOCAL_TENANT.tenantId) !== tenantId) continue
			client.send(payload)
		}
	}
	const imageGenerators = new Map<string, ImageGenerationService>()
	const imageGenerationFor = (tenantId: string): ImageGenerationService => {
		const existing = imageGenerators.get(tenantId)
		if (existing) return existing
		const created = new ImageGenerationService(
			boards.forTenant({ tenantId }),
			(event) => broadcast(event, tenantId),
			{
				generator: options.imageGenerator,
				config: config.image,
				env,
			},
		)
		imageGenerators.set(tenantId, created)
		return created
	}
	const imageGeneration = imageGenerationFor(LOCAL_TENANT.tenantId)

	function isAllowedHost(host: string | undefined, pathname: string): boolean {
		if (runtimeConfig.publicOrigin) {
			const publicUrl = new URL(runtimeConfig.publicOrigin)
			if (host?.toLowerCase() === publicUrl.host.toLowerCase()) return true
			if (pathname === '/api/live' && host) {
				const address = server.address()
				const listeningPort = address && typeof address !== 'string' ? address.port : port
				if (host === `127.0.0.1:${listeningPort}` || host === `localhost:${listeningPort}`)
					return true
			}
			return false
		}
		const address = server.address()
		const listeningPort = address && typeof address !== 'string' ? address.port : port
		return host === `127.0.0.1:${listeningPort}` || host === `localhost:${listeningPort}`
	}

	function isAllowedOrigin(origin: string | undefined): boolean {
		if (runtimeConfig.publicOrigin) return origin === runtimeConfig.publicOrigin
		return origin !== undefined && ALLOWED_ORIGINS.has(origin)
	}

	function canonicalRequestOrigin(req: IncomingMessage): string | undefined {
		return typeof req.headers.origin === 'string' ? req.headers.origin : undefined
	}

	function sendAiDisabled(res: ServerResponse, origin?: string): void {
		sendError(res, 503, 'AI_DISABLED', 'AI features are disabled', origin)
	}

	const replyError = (res: ServerResponse, error: unknown, origin?: string): void => {
		if (error instanceof OperationError) {
			sendError(res, error.status, error.code, error.message, origin)
			return
		}
		console.error(error)
		sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error', origin)
	}

	const server = createServer(async (req, res) => {
		if (runtimeConfig.auth.mode === 'entra') res.setHeader('Cache-Control', 'private, no-store')
		let pathname: string
		let requestUrl: URL
		try {
			const target = parseRequestTarget(req.url)
			requestUrl = target.url
			pathname = target.pathname
		} catch {
			sendError(res, 400, 'INVALID_REQUEST', 'Invalid request URL')
			return
		}

		if (!isAllowedHost(req.headers.host, pathname)) {
			sendError(res, 403, 'FORBIDDEN_HOST', 'Host is not allowed')
			return
		}

		const origin = canonicalRequestOrigin(req)
		if (origin && !isAllowedOrigin(origin)) {
			sendError(res, 403, 'FORBIDDEN_ORIGIN', 'Origin is not allowed', origin)
			return
		}
		const includePreviews = requestUrl.searchParams.get('previews') !== '0'

		const segments = pathname.split('/').filter(Boolean)
		const isPath = (...parts: string[]) =>
			segments.length === parts.length && parts.every((part, index) => segments[index] === part)
		const canvasId =
			segments[0] === 'api' && segments[1] === 'canvases' && segments.length === 3
				? segments[2]
				: null

		if (req.method === 'OPTIONS') {
			if (!knownPath(pathname)) {
				sendError(res, 404, 'NOT_FOUND', 'Endpoint not found', origin)
				return
			}
			if (origin && isAllowedOrigin(origin)) {
				res.setHeader('Access-Control-Allow-Origin', origin)
				res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
				res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
				res.setHeader('Vary', 'Origin')
			}
			res.writeHead(204)
			res.end()
			return
		}

		try {
			if (isPath('api', 'runtime')) {
				res.setHeader('Cache-Control', 'no-store')
				if (req.method !== 'GET') {
					res.setHeader('Allow', 'GET, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				sendJson(res, 200, publicRuntimeContract(runtimeConfig), origin)
				return
			}

			if (isPath('api', 'auth', 'session')) {
				res.setHeader('Cache-Control', 'no-store')
				if (req.method === 'GET') {
					if (runtimeConfig.auth.mode === 'entra') {
						const session = auth.getSession(req)
						if (!session) {
							sendError(res, 401, 'UNAUTHENTICATED', 'Authentication required', origin)
							return
						}
						sendJson(
							res,
							200,
							{ user: { name: session.name, expiresAt: session.expiresAt } },
							origin,
						)
						return
					}
					sendJson(res, 200, { user: null }, origin)
					return
				}
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'GET, POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				if (runtimeConfig.auth.mode !== 'entra') {
					res.writeHead(204)
					res.end()
					return
				}
				if (!origin || !isAllowedOrigin(origin)) {
					sendError(
						res,
						403,
						'FORBIDDEN_ORIGIN',
						'Origin is required and must match the public origin',
						origin,
					)
					return
				}
				const contentType =
					typeof req.headers['content-type'] === 'string'
						? req.headers['content-type'].split(';', 1)[0].trim().toLowerCase()
						: ''
				if (contentType !== 'application/json') {
					sendError(
						res,
						415,
						'UNSUPPORTED_MEDIA_TYPE',
						'Content-Type must be application/json',
						origin,
					)
					return
				}
				const body = await readAuthJson(req)
				if (
					!isRecord(body) ||
					Object.keys(body).length !== 1 ||
					typeof body.id_token !== 'string'
				) {
					throw new OperationError(400, 'INVALID_REQUEST', 'id_token must be a string')
				}
				const user = await auth.verifyIdToken(body.id_token)
				const token = auth.issueSession(user)
				auth.setSessionCookie(res, token, user.expiresAt)
				res.writeHead(204)
				res.end()
				return
			}

			if (isPath('api', 'auth', 'logout')) {
				res.setHeader('Cache-Control', 'no-store')
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				if (
					(runtimeConfig.auth.mode === 'entra' || runtimeConfig.publicOrigin) &&
					(!origin || !isAllowedOrigin(origin))
				) {
					sendError(
						res,
						403,
						'FORBIDDEN_ORIGIN',
						'Origin is required and must match the public origin',
						origin,
					)
					return
				}
				auth.revokeRequest(req)
				auth.clearSessionCookie(res)
				res.writeHead(204)
				res.end()
				return
			}

			if (
				(runtimeConfig.auth.mode === 'entra' || runtimeConfig.publicOrigin) &&
				(req.method === 'POST' ||
					req.method === 'PUT' ||
					req.method === 'PATCH' ||
					req.method === 'DELETE') &&
				(!origin || !isAllowedOrigin(origin))
			) {
				sendError(
					res,
					403,
					'FORBIDDEN_ORIGIN',
					'Origin is required and must match the canonical origin',
					origin,
				)
				return
			}

			const session = runtimeConfig.auth.mode === 'entra' ? auth.getSession(req) : undefined
			if (
				runtimeConfig.auth.mode === 'entra' &&
				pathname !== '/api/live' &&
				!session &&
				(pathname.startsWith('/api/') || pathname.startsWith('/mai/') || pathname === '/moss')
			) {
				sendError(res, 401, 'UNAUTHENTICATED', 'Authentication required', origin)
				return
			}

			const tenantId = tenantScopeFor(session).tenantId
			const store = boards.forTenant({ tenantId })
			const send = (event: unknown): void => broadcast(event, tenantId)
			let tenantImages: ImageGenerationService | undefined
			const images = (): ImageGenerationService => {
				tenantImages ??= imageGenerationFor(tenantId)
				return tenantImages
			}

			if (
				runtimeConfig.auth.mode === 'entra' &&
				req.method === 'GET' &&
				(pathname === '/login' || pathname === '/auth/callback')
			) {
				if (assets) {
					res.writeHead(200, {
						'Content-Type': 'text/html; charset=utf-8',
						'Cache-Control': 'no-store',
					})
					res.end(readFileSync(resolve(options.staticDir as string, 'index.html')))
					return
				}
				sendError(res, 404, 'NOT_FOUND', 'Built index.html is not configured', origin)
				return
			}

			const publicAsset =
				pathname.startsWith('/assets/') || pathname === '/favicon.ico' || pathname === '/logo.png'
			if (
				runtimeConfig.auth.mode === 'entra' &&
				assets &&
				(req.method === 'GET' || req.method === 'HEAD') &&
				!pathname.startsWith('/api/') &&
				!publicAsset
			) {
				if (!auth.getSession(req)) {
					res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' })
					res.end()
					return
				}
			}

			if (runtimeConfig.aiEnabled === false && pathname === MAI_CONFIG_PATH) {
				if (req.method !== 'GET') {
					res.setHeader('Allow', 'GET')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				sendAiDisabled(res, origin)
				return
			}
			if (runtimeConfig.aiEnabled && assets && pathname === MAI_CONFIG_PATH) {
				if (req.method !== 'GET') {
					res.setHeader('Allow', 'GET')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				sendJson(
					res,
					200,
					{
						host: config.mai.host,
						deployment: config.mai.deployment,
						localPath: MAI_LOCAL_PATH,
					},
					origin,
				)
				return
			}
			if (assets && (req.method === 'GET' || req.method === 'HEAD') && segments[0] !== 'api') {
				assets(req, res, (error) => {
					if (res.headersSent) {
						res.destroy()
						return
					}
					res.removeHeader('Content-Length')
					const status = error?.statusCode ?? 404
					sendError(res, status, 'STATIC_FILE_ERROR', 'Could not serve file', origin)
				})
				return
			}

			if (isPath('api', 'live')) {
				if (req.method !== 'GET') {
					res.setHeader('Allow', 'GET, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				sendJson(res, 200, { status: 'ok', version: manifest.version }, origin)
				return
			}

			if (isPath('api', 'state')) {
				if (req.method !== 'GET') {
					res.setHeader('Allow', 'GET, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				sendJson(res, 200, await store.getState(includePreviews), origin)
				return
			}

			if (isPath('api', 'board')) {
				if (req.method !== 'GET') {
					res.setHeader('Allow', 'GET, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				sendJson(res, 200, await store.getBoard(), origin)
				return
			}

			if (isPath('api', 'images')) {
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const contentLength = req.headers['content-length']
				if (contentLength !== undefined && Number(contentLength) > MAX_IMAGE_BYTES) {
					throw new OperationError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 10 MB')
				}
				const declared =
					typeof req.headers['content-type'] === 'string'
						? req.headers['content-type'].split(';', 1)[0].trim().toLowerCase()
						: ''
				if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(declared)) {
					throw new OperationError(
						415,
						'UNSUPPORTED_MEDIA_TYPE',
						'Content-Type must be a supported image type',
					)
				}
				const bytes = await readRaw(req)
				const detected = detectImageType(bytes)
				if (!detected) {
					throw new OperationError(
						415,
						'UNSUPPORTED_MEDIA_TYPE',
						'Image bytes do not contain a supported signature',
					)
				}
				if (detected !== declared) {
					throw new OperationError(
						415,
						'UNSUPPORTED_MEDIA_TYPE',
						'Content-Type does not match image bytes',
					)
				}
				const id = await store.saveImage(bytes, detected)
				sendJson(res, 200, { id }, origin)
				return
			}

			if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'images') {
				if (req.method !== 'GET') {
					res.setHeader('Allow', 'GET, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const asset = await store.getImage(segments[2])
				if (!asset) {
					throw new OperationError(404, 'NOT_FOUND', 'Image not found')
				}
				if (origin && isAllowedOrigin(origin)) {
					res.setHeader('Access-Control-Allow-Origin', origin)
					res.setHeader('Vary', 'Origin')
				}
				res.writeHead(200, {
					'Content-Type': asset.contentType,
					'Content-Length': asset.bytes.byteLength,
					'Cache-Control': 'private, no-store',
					'X-Content-Type-Options': 'nosniff',
					'Cross-Origin-Resource-Policy': 'same-origin',
				})
				res.end(asset.bytes)
				return
			}

			if (isPath('api', 'canvases')) {
				if (req.method === 'GET') {
					sendJson(res, 200, await store.getCanvasList(includePreviews), origin)
					return
				}
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'GET, POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const body = await readJson(req)
				if (body !== undefined && !isRecord(body)) invalid('request must be an object')
				const record = isRecord(body) ? body : {}
				if (!exactKeys(record, ['name', 'activate'])) invalid('invalid canvas request')
				if (record.activate !== undefined && typeof record.activate !== 'boolean') {
					invalid('activate must be a boolean')
				}
				const created = await store.createCanvas(record.name, record.activate === true)
				send({ type: 'snapshot', ...created.state })
				sendJson(res, 200, { ...created.state, createdCanvasId: created.canvas.id }, origin)
				return
			}

			if (canvasId !== null) {
				if (req.method === 'GET') {
					sendJson(res, 200, await store.getCanvas(canvasId), origin)
					return
				}
				if (req.method === 'PATCH') {
					const body = await readJson(req)
					if (!isRecord(body) || !exactKeys(body, ['name'])) invalid('invalid canvas request')
					const state = await store.renameCanvas(canvasId, body.name)
					send({ type: 'snapshot', ...state })
					sendJson(res, 200, state, origin)
					return
				}
				if (req.method === 'DELETE') {
					const state = await store.deleteCanvas(canvasId)
					send({ type: 'snapshot', ...state })
					sendJson(res, 200, state, origin)
					return
				}
				res.setHeader('Allow', 'GET, PATCH, DELETE, OPTIONS')
				sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
				return
			}

			if (isPath('api', 'active-canvas')) {
				if (req.method !== 'PUT') {
					res.setHeader('Allow', 'PUT, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const body = await readJson(req)
				if (!isRecord(body) || !exactKeys(body, ['id'])) invalid('invalid active canvas request')
				if (typeof body.id !== 'string') invalid('canvas id must be a string')
				const state = await store.activateCanvas(body.id)
				send({ type: 'snapshot', ...state })
				sendJson(res, 200, state, origin)
				return
			}

			if (isPath('api', 'moss', 'session')) {
				if (!runtimeConfig.aiEnabled) {
					sendAiDisabled(res, origin)
					return
				}
				if (!runtimeConfig.mossEnabled) {
					sendError(res, 503, 'MOSS_DISABLED', 'MOSS Live is disabled', origin)
					return
				}
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const response = await createMossSession(store, send, await readJson(req), images())
				sendJson(res, 200, response, origin)
				return
			}

			if (isPath('api', 'moss', 'tool')) {
				if (!runtimeConfig.aiEnabled) {
					sendAiDisabled(res, origin)
					return
				}
				if (!runtimeConfig.mossEnabled) {
					sendError(res, 503, 'MOSS_DISABLED', 'MOSS Live is disabled', origin)
					return
				}
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const response = await executeMossTool(store, send, await readJson(req), images())
				sendJson(res, 200, response, origin)
				return
			}

			if (isPath('api', 'ai', 'settings')) {
				if (req.method === 'GET') {
					sendJson(res, 200, aiSettings.getPublic(), origin)
					return
				}
				if (req.method !== 'PUT') {
					res.setHeader('Allow', 'GET, PUT, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const settings = await aiSettings.update(await readJson(req))
				sendJson(res, 200, settings, origin)
				return
			}

			if (isPath('api', 'ai', 'models')) {
				if (!runtimeConfig.aiEnabled) {
					sendAiDisabled(res, origin)
					return
				}
				if (req.method !== 'GET') {
					res.setHeader('Allow', 'GET, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const models = await fetchAiModels(
					aiSettings.getEffective(),
					5000,
					managedIdentityAuth?.chatBearer,
				)
				sendJson(res, 200, { models }, origin)
				return
			}

			if (isPath('api', 'ai', 'chat')) {
				if (!runtimeConfig.aiEnabled) {
					sendAiDisabled(res, origin)
					return
				}
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const request = await parseAiChatRequest(await readJson(req))
				const model = aiModel ? aiModel : modelFactory(aiSettings.getEffective())
				await streamAiChat({
					res,
					store,
					broadcast: send,
					model,
					request,
					origin,
					imageGeneration: images(),
					lectureReasoning: config.lectureReasoning,
				})
				return
			}

			if (isPath('api', 'operations')) {
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const result = await store.applyRequest(await readJson(req, true))
				send({
					type: 'board',
					canvasId: result.canvasId,
					canvas: result.canvas,
					board: result.board,
				})
				sendJson(res, 200, result.board, origin)
				return
			}
		} catch (error) {
			replyError(res, error, origin)
			return
		}

		if (
			req.method === 'GET' ||
			req.method === 'POST' ||
			req.method === 'PUT' ||
			req.method === 'PATCH' ||
			req.method === 'DELETE'
		) {
			sendError(res, 404, 'NOT_FOUND', 'Endpoint not found', origin)
			return
		}
		res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
		sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
	})

	wss.on('connection', (socket: WebSocket) => {
		socket.on('error', () => socket.terminate())
		const socketScope = { tenantId: socketTenant.get(socket) ?? LOCAL_TENANT.tenantId }
		boards
			.forTenant(socketScope)
			.getState()
			.then((state) => socket.send(JSON.stringify({ type: 'snapshot', ...state })))
			.catch((error: unknown) => {
				console.error(error)
				socket.close(1011, 'Could not read the board')
			})
	})

	server.on('upgrade', (req, socket, head) => {
		let pathname: string
		try {
			pathname = parseRequestTarget(req.url).pathname
		} catch {
			socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
			socket.destroy()
			return
		}
		if (!isAllowedHost(req.headers.host, pathname)) {
			socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
			socket.destroy()
			return
		}

		const origin = req.headers.origin
		if (
			(runtimeConfig.auth.mode === 'entra' || runtimeConfig.publicOrigin) &&
			(!origin || !isAllowedOrigin(origin))
		) {
			socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
			socket.destroy()
			return
		}
		if (origin && !isAllowedOrigin(origin)) {
			socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
			socket.destroy()
			return
		}

		const session = runtimeConfig.auth.mode === 'entra' ? auth.getSession(req) : undefined
		if (runtimeConfig.auth.mode === 'entra' && !session) {
			socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
			socket.destroy()
			return
		}
		const tenantId = tenantScopeFor(session).tenantId

		if (!runtimeConfig.aiEnabled && (pathname === MAI_LOCAL_PATH || pathname === MOSS_LOCAL_PATH)) {
			socket.write(
				'HTTP/1.1 503 Service Unavailable\r\nX-Mico-Error: AI_DISABLED\r\nConnection: close\r\n\r\n',
			)
			socket.destroy()
			return
		}
		if (runtimeConfig.aiEnabled && !runtimeConfig.mossEnabled && pathname === MOSS_LOCAL_PATH) {
			socket.write(
				'HTTP/1.1 503 Service Unavailable\r\nX-Mico-Error: MOSS_DISABLED\r\nConnection: close\r\n\r\n',
			)
			socket.destroy()
			return
		}
		if (mai && pathname === MAI_LOCAL_PATH) {
			req.url = pathname
			mai.upgrade(req, socket, head)
			return
		}
		if (moss && pathname === MOSS_LOCAL_PATH) {
			req.url = pathname
			moss.upgrade(req, socket, head)
			return
		}
		if (pathname !== '/api/events') {
			socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
			socket.destroy()
			return
		}

		wss.handleUpgrade(req, socket, head, (client) => {
			socketTenant.set(client, tenantId)
			if (runtimeConfig.auth.mode === 'entra') auth.attachSocket(req, client)
			wss.emit('connection', client, req)
		})
	})

	let closing: Promise<void> | undefined
	return {
		server,
		runtimeConfig,
		boards,
		store,
		aiSettings,
		imageGeneration,
		wss,
		close(): Promise<void> {
			closing ??= new Promise<void>((resolveClose) => {
				auth.close()
				const timeout = setTimeout(() => server.closeAllConnections(), 5000)
				timeout.unref()
				server.close(() => {
					clearTimeout(timeout)
					boards.close().finally(resolveClose)
				})
				for (const service of imageGenerators.values()) service.close()
				mai?.close()
				moss?.close()
				for (const client of wss.clients) client.terminate()
				wss.close()
			})
			return closing
		},
	}
}

export function startDaemon(): Daemon {
	const env = loadRuntimeEnv()
	const port = parsePort(env)
	const host = env.MICO_HOST || '127.0.0.1'
	const daemon = createDaemon({ port, staticDir: env.MICO_STATIC_DIR, env })
	daemon.server.listen(port, host, () => {
		console.log(`MICO daemon listening on http://${host}:${port}`)
	})
	return daemon
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	const daemon = startDaemon()
	const shutdown = (): void => {
		console.log('MICO daemon stopping')
		void daemon.close().then(() => process.exit(0))
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}
