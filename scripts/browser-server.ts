import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import {
	createServer as createHttpServer,
	request as httpRequest,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http'
import { connect as netConnect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import serveStatic from 'serve-static'
import { createServer as createViteServer } from 'vite'
import { createMockAiModel } from '../src/server/aiMock.ts'
import { createDaemon } from '../src/server/index.ts'
import { maiRealtimeProxy } from '../src/server/maiProxy.ts'
import { BROWSER_PORT } from '../src/shared/config.ts'
import { micoViteConfig } from '../vite.config.ts'

export interface BrowserServer {
	origin: string
	close: () => Promise<void>
}

function proxyHeaders(
	headers: IncomingMessage['headers'],
	browserOrigin: string,
	targetPort: number,
): IncomingMessage['headers'] {
	const forwarded: IncomingMessage['headers'] = {
		...headers,
		host: `127.0.0.1:${targetPort}`,
	}
	if (forwarded.origin === browserOrigin) {
		forwarded.origin = `http://127.0.0.1:${BROWSER_PORT}`
	}
	return forwarded
}

function proxyHttp(
	req: IncomingMessage,
	res: ServerResponse,
	browserOrigin: string,
	targetPort: number,
): void {
	const upstream = httpRequest(
		{
			host: '127.0.0.1',
			port: targetPort,
			path: req.url,
			method: req.method,
			headers: proxyHeaders(req.headers, browserOrigin, targetPort),
		},
		(upstreamRes) => {
			res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
			upstreamRes.pipe(res)
		},
	)
	upstream.on('error', () => {
		if (!res.headersSent) res.writeHead(502)
		res.end()
	})
	req.pipe(upstream)
}

export async function startBrowserServer(
	browserPort = BROWSER_PORT,
	aiMock = process.env.MICO_AI_MOCK === '1',
): Promise<BrowserServer> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-browser-'))
	const origin = `http://127.0.0.1:${browserPort}`
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'ai-settings', 'settings.json'),
		env: {},
		aiModel: aiMock ? createMockAiModel() : undefined,
	})
	await daemon.boards.waitUntilReady()
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening')
	const address = daemon.server.address()
	if (!address || typeof address === 'string') {
		throw new Error('Failed to bind isolated daemon port')
	}
	const daemonPort = address.port

	const distDir = resolve('dist')
	const distIndexPath = join(distDir, 'index.html')

	if (existsSync(distIndexPath)) {
		const indexHtml = readFileSync(distIndexPath)
		const staticMiddleware = serveStatic(distDir, { fallthrough: true })
		const httpServer = createHttpServer((req, res) => {
			const pathname = new URL(req.url ?? '/', origin).pathname
			if (pathname === '/mai/config') {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(
					JSON.stringify({
						host: 'browser-mock.test',
						deployment: 'browser-mock',
						localPath: '/mai/realtime',
					}),
				)
				return
			}
			if (pathname.startsWith('/api/')) {
				proxyHttp(req, res, origin, daemonPort)
				return
			}
			staticMiddleware(req, res, () => {
				if ((req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/assets/')) {
					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
					res.end(req.method === 'HEAD' ? undefined : indexHtml)
					return
				}
				res.writeHead(404)
				res.end()
			})
		})

		httpServer.on('upgrade', (req, socket, head) => {
			const upstream = netConnect(daemonPort, '127.0.0.1', () => {
				const rawHeaders = req.rawHeaders
				let requestText = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
				for (let index = 0; index < rawHeaders.length; index += 2) {
					const name = rawHeaders[index]
					const lower = name.toLowerCase()
					let value = rawHeaders[index + 1]
					if (lower === 'host') value = `127.0.0.1:${daemonPort}`
					else if (lower === 'origin' && value === origin) {
						value = `http://127.0.0.1:${BROWSER_PORT}`
					}
					requestText += `${name}: ${value}\r\n`
				}
				requestText += '\r\n'
				upstream.write(requestText)
				if (head.length > 0) upstream.write(head)
				upstream.pipe(socket)
				socket.pipe(upstream)
			})
			upstream.on('error', () => socket.destroy())
			socket.on('error', () => upstream.destroy())
		})

		httpServer.listen(browserPort, '127.0.0.1')
		await once(httpServer, 'listening')

		let stopping = false
		return {
			origin,
			close: async () => {
				if (stopping) return
				stopping = true
				await new Promise<void>((resolveClose) => {
					httpServer.close(() => resolveClose())
					httpServer.closeAllConnections()
				})
				for (const client of daemon.wss.clients) client.terminate()
				await daemon.close()
				rmSync(directory, { recursive: true, force: true })
			},
		}
	}

	const base = micoViteConfig()
	const plugins = [
		...base.plugins,
		maiRealtimeProxy({
			host: 'browser-mock.test',
			apiKey: '',
			deployment: 'browser-mock',
		}),
	]
	const vite = await createViteServer({
		...base,
		plugins,
		configFile: false,
		cacheDir: join(directory, 'vite-cache'),
		server: {
			...base.server,
			port: browserPort,
			proxy: { '/api': { target: `http://127.0.0.1:${daemonPort}`, changeOrigin: true, ws: true } },
		},
	})
	await vite.listen()

	let stopping = false
	return {
		origin,
		close: async () => {
			if (stopping) return
			stopping = true
			await vite.close()
			for (const client of daemon.wss.clients) client.terminate()
			await daemon.close()
			rmSync(directory, { recursive: true, force: true })
		},
	}
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	const server = await startBrowserServer()
	console.log(`Browser fixture listening on ${server.origin}`)
	process.on('SIGINT', () => void server.close().then(() => process.exit(0)))
	process.on('SIGTERM', () => void server.close().then(() => process.exit(0)))
}
