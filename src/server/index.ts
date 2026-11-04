import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LanguageModel } from 'ai'
import WebSocket, { WebSocketServer } from 'ws'
import manifest from '../../package.json' with { type: 'json' }
import { ALLOWED_ORIGINS, DAEMON_PORT } from '../shared/config.ts'
import { createMagpieModel, type MagpieSettings, parseAiChatRequest, streamAiChat } from './ai.ts'
import { AI_SETTINGS_PATH, AiSettingsStore } from './aiSettings.ts'
import { BoardStore, OperationError } from './store.ts'

function parsePort(): number {
	const raw = process.env.MICO_PORT
	if (!raw) return DAEMON_PORT
	const port = Number(raw)
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('MICO_PORT must be an integer from 1 to 65535')
	}
	return port
}

function readJson(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolveBody, reject) => {
		const chunks: Buffer[] = []
		let size = 0
		let tooLarge = false
		req.on('data', (chunk: Buffer) => {
			if (tooLarge) return
			size += chunk.length
			if (size > 1024 * 1024) {
				tooLarge = true
				reject(new OperationError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB'))
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
		return ['live', 'state', 'board', 'operations', 'events', 'canvases', 'active-canvas'].includes(
			segments[1],
		)
	}
	if (segments.length === 3) {
		return (
			segments[1] === 'canvases' ||
			(segments[1] === 'ai' && ['chat', 'settings'].includes(segments[2]))
		)
	}
	return false
}

export interface Daemon {
	server: ReturnType<typeof createServer>
	store: BoardStore
	aiSettings: AiSettingsStore
	wss: WebSocketServer
	close(): void
}

export function createDaemon(
	options: {
		port?: number
		dbPath?: string
		aiModel?: LanguageModel
		settingsPath?: string
		env?: NodeJS.ProcessEnv
		createAiModel?: (settings: MagpieSettings) => LanguageModel
	} = {},
): Daemon {
	const port = options.port ?? parsePort()
	const dbPath = options.dbPath ?? process.env.MICO_DB_PATH ?? '.mico/board.sqlite'
	const store = new BoardStore(dbPath)
	const settingsPath = options.settingsPath
	const aiSettings = new AiSettingsStore({
		path: settingsPath ?? AI_SETTINGS_PATH,
		env: options.env ?? process.env,
		persist: settingsPath !== undefined || options.aiModel === undefined,
	})
	const aiModel = options.aiModel
	const modelFactory = options.createAiModel ?? createMagpieModel
	const wss = new WebSocketServer({ noServer: true })

	function isAllowedHost(host: string | undefined): boolean {
		const address = server.address()
		const listeningPort = address && typeof address !== 'string' ? address.port : port
		return host === `127.0.0.1:${listeningPort}` || host === `localhost:${listeningPort}`
	}

	const broadcast = (event: unknown): void => {
		const payload = JSON.stringify(event)
		for (const client of wss.clients) {
			if (client.readyState === WebSocket.OPEN) client.send(payload)
		}
	}

	const broadcastState = (state = store.getState()): void => {
		broadcast({ type: 'snapshot', ...state })
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
		if (!isAllowedHost(req.headers.host)) {
			sendError(res, 403, 'FORBIDDEN_HOST', 'Host is not allowed')
			return
		}

		const origin = req.headers.origin
		if (origin && !ALLOWED_ORIGINS.has(origin)) {
			sendError(res, 403, 'FORBIDDEN_ORIGIN', 'Origin is not allowed', origin)
			return
		}

		let pathname: string
		let requestUrl: URL
		try {
			requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
			pathname = requestUrl.pathname
		} catch {
			sendError(res, 400, 'INVALID_REQUEST', 'Invalid request URL', origin)
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
			if (origin && ALLOWED_ORIGINS.has(origin)) {
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
				sendJson(res, 200, store.getState(includePreviews), origin)
				return
			}

			if (isPath('api', 'board')) {
				if (req.method !== 'GET') {
					res.setHeader('Allow', 'GET, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				sendJson(res, 200, store.getBoard(), origin)
				return
			}

			if (isPath('api', 'canvases')) {
				if (req.method === 'GET') {
					sendJson(res, 200, store.getCanvasList(includePreviews), origin)
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
				const created = store.createCanvas(record.name, record.activate === true)
				broadcastState(created.state)
				sendJson(res, 200, { ...created.state, createdCanvasId: created.canvas.id }, origin)
				return
			}

			if (canvasId !== null) {
				if (req.method === 'GET') {
					sendJson(res, 200, store.getCanvas(canvasId), origin)
					return
				}
				if (req.method === 'PATCH') {
					const body = await readJson(req)
					if (!isRecord(body) || !exactKeys(body, ['name'])) invalid('invalid canvas request')
					const state = store.renameCanvas(canvasId, body.name)
					broadcastState(state)
					sendJson(res, 200, state, origin)
					return
				}
				if (req.method === 'DELETE') {
					const state = store.deleteCanvas(canvasId)
					broadcastState(state)
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
				const state = store.activateCanvas(body.id)
				broadcastState(state)
				sendJson(res, 200, state, origin)
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

			if (isPath('api', 'ai', 'chat')) {
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const request = await parseAiChatRequest(await readJson(req))
				const model = aiModel ?? modelFactory(aiSettings.getEffective())
				await streamAiChat({ res, store, broadcast, model, request, origin })
				return
			}

			if (isPath('api', 'operations')) {
				if (req.method !== 'POST') {
					res.setHeader('Allow', 'POST, OPTIONS')
					sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
					return
				}
				const result = store.applyRequest(await readJson(req))
				broadcast({
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
		try {
			socket.send(JSON.stringify({ type: 'snapshot', ...store.getState() }))
		} catch (error) {
			console.error(error)
			socket.close(1011, 'Could not read the board')
		}
	})

	server.on('upgrade', (req, socket, head) => {
		if (!isAllowedHost(req.headers.host)) {
			socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
			socket.destroy()
			return
		}

		const origin = req.headers.origin
		if (origin && !ALLOWED_ORIGINS.has(origin)) {
			socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
			socket.destroy()
			return
		}

		let pathname: string
		try {
			pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
		} catch {
			socket.destroy()
			return
		}
		if (pathname !== '/api/events') {
			socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
			socket.destroy()
			return
		}

		wss.handleUpgrade(req, socket, head, (socket) => {
			wss.emit('connection', socket, req)
		})
	})

	return {
		server,
		store,
		aiSettings,
		wss,
		close(): void {
			wss.close()
			store.close()
			server.close()
		},
	}
}

export function startDaemon(): Daemon {
	const port = parsePort()
	const daemon = createDaemon({ port })
	daemon.server.listen(port, '127.0.0.1', () => {
		console.log(`MICO daemon listening on http://127.0.0.1:${port}`)
	})
	return daemon
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	const daemon = startDaemon()
	const shutdown = (): void => {
		daemon.close()
		process.exit(0)
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}
