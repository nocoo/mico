import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket, { WebSocketServer } from 'ws'
import manifest from '../../package.json' with { type: 'json' }
import { ALLOWED_ORIGINS, DAEMON_PORT } from '../shared/config.ts'
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
		req.on('data', (chunk: Buffer) => {
			size += chunk.length
			if (size > 1024 * 1024) {
				reject(new OperationError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB'))
				req.destroy()
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => {
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

export interface Daemon {
	server: ReturnType<typeof createServer>
	store: BoardStore
	wss: WebSocketServer
	close(): void
}

export function createDaemon(options: { port?: number; dbPath?: string } = {}): Daemon {
	const port = options.port ?? parsePort()
	const dbPath = options.dbPath ?? process.env.MICO_DB_PATH ?? '.mico/board.sqlite'
	const store = new BoardStore(dbPath)

	function isAllowedHost(host: string | undefined): boolean {
		const address = server.address()
		const listeningPort = address && typeof address !== 'string' ? address.port : port
		return host === `127.0.0.1:${listeningPort}` || host === `localhost:${listeningPort}`
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
		try {
			pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
		} catch {
			sendError(res, 400, 'INVALID_REQUEST', 'Invalid request URL', origin)
			return
		}

		if (req.method === 'OPTIONS') {
			if (
				pathname !== '/api/live' &&
				pathname !== '/api/board' &&
				pathname !== '/api/operations' &&
				pathname !== '/api/events'
			) {
				sendError(res, 404, 'NOT_FOUND', 'Endpoint not found', origin)
				return
			}
			if (origin && ALLOWED_ORIGINS.has(origin)) {
				res.setHeader('Access-Control-Allow-Origin', origin)
				res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
				res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
				res.setHeader('Vary', 'Origin')
			}
			res.writeHead(204)
			res.end()
			return
		}

		if (pathname === '/api/live') {
			if (req.method !== 'GET') {
				res.setHeader('Allow', 'GET, OPTIONS')
				sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
				return
			}
			sendJson(res, 200, { status: 'ok', version: manifest.version }, origin)
			return
		}

		if (pathname === '/api/board') {
			if (req.method !== 'GET') {
				res.setHeader('Allow', 'GET, OPTIONS')
				sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
				return
			}
			try {
				sendJson(res, 200, store.getBoard(), origin)
			} catch (error) {
				console.error(error)
				sendError(res, 500, 'INTERNAL_ERROR', 'Could not read the board', origin)
			}
			return
		}

		if (pathname === '/api/operations') {
			if (req.method !== 'POST') {
				res.setHeader('Allow', 'POST, OPTIONS')
				sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
				return
			}
			try {
				const request = await readJson(req)
				const board = store.apply(request)
				broadcast(JSON.stringify(board))
				sendJson(res, 200, board, origin)
			} catch (error) {
				if (error instanceof OperationError) {
					sendError(res, error.status, error.code, error.message, origin)
					return
				}
				console.error(error)
				sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error', origin)
			}
			return
		}

		if (req.method === 'GET' || req.method === 'POST') {
			sendError(res, 404, 'NOT_FOUND', 'Endpoint not found', origin)
			return
		}
		res.setHeader('Allow', 'GET, POST, OPTIONS')
		sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', origin)
	})

	const wss = new WebSocketServer({ noServer: true })

	const broadcast = (payload: string): void => {
		for (const client of wss.clients) {
			if (client.readyState === WebSocket.OPEN) client.send(payload)
		}
	}

	wss.on('connection', (socket: WebSocket) => {
		socket.on('error', () => socket.terminate())
		try {
			socket.send(JSON.stringify(store.getBoard()))
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
