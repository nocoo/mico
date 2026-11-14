import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import WebSocket, { WebSocketServer } from 'ws'
import { isMossUpgradeAllowed } from './mossProxy.ts'

const UPSTREAM_PATH = '/mai/v1/realtime?intent=transcription'
export const MAI_LOCAL_PATH = '/mai/realtime'
export const MAI_CONFIG_PATH = '/mai/config'

export interface MaiProxyOptions {
	host: string
	apiKey: string
	deployment: string
	allowedOrigin?: string
	onConnection?: (req: IncomingMessage, client: WebSocket) => void
	createUpstream?: (
		url: string,
		options: { headers: { 'api-key': string } | { Authorization: string } },
	) => WebSocket
	bearerProvider?: () => Promise<string>
	maxBufferedBytes?: number
	maxBacklogFrames?: number
	onError?: (error: Error) => void
}

export function createMaiProxy(options: MaiProxyOptions): {
	upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
	close(): void
} {
	const wss = new WebSocketServer({ noServer: true })
	const upstreams = new Set<WebSocket>()
	const createUpstream =
		options.createUpstream ?? ((url, upstreamOptions) => new WebSocket(url, upstreamOptions))
	let closed = false

	const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		if (closed) {
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
		if (pathname !== MAI_LOCAL_PATH) return
		if (!isMossUpgradeAllowed(req.headers.origin, req.headers.host, options.allowedOrigin)) {
			socket.destroy()
			return
		}

		wss.handleUpgrade(req, socket, head, (client) => {
			client.on('error', () => client.terminate())
			options.onConnection?.(req, client)

			if (!options.host || (!options.apiKey && !options.bearerProvider) || !options.deployment) {
				client.send(
					JSON.stringify({
						action: 'proxy.error',
						message:
							'MAI credentials or identity configuration are missing from the server environment',
					}),
				)
				client.close(1008, 'MAI config unavailable')
				return
			}

			const maxFrames = options.maxBacklogFrames ?? 256
			const maxBytes = options.maxBufferedBytes ?? 4 * 1024 * 1024
			const backlog: [WebSocket.RawData, boolean][] = []
			let backlogBytes = 0
			let clientClosed = false
			let upstream: WebSocket | undefined

			client.on('message', (data, isBinary) => {
				if (clientClosed) return
				if (upstream?.readyState === WebSocket.OPEN) {
					upstream.send(data, { binary: isBinary })
					return
				}
				if (upstream?.readyState === WebSocket.CONNECTING || !upstream) {
					const frameBytes =
						typeof data === 'string'
							? Buffer.byteLength(data)
							: data instanceof ArrayBuffer
								? data.byteLength
								: Buffer.isBuffer(data)
									? data.length
									: (data as unknown as Buffer[]).reduce((total, part) => total + part.length, 0)
					if (backlog.length >= maxFrames || backlogBytes + frameBytes > maxBytes) {
						client.close(1013, 'MAI client backlog exceeded')
						return
					}
					backlog.push([data, isBinary])
					backlogBytes += frameBytes
				}
			})
			client.on('close', () => {
				clientClosed = true
				if (
					upstream &&
					(upstream.readyState === WebSocket.CONNECTING || upstream.readyState === WebSocket.OPEN)
				) {
					upstream.close()
				}
			})

			void (async () => {
				let authHeaders: { 'api-key': string } | { Authorization: string }
				try {
					if (options.bearerProvider) {
						authHeaders = { Authorization: `Bearer ${await options.bearerProvider()}` }
					} else {
						authHeaders = { 'api-key': options.apiKey }
					}
				} catch {
					if (!clientClosed && client.readyState === WebSocket.OPEN) {
						client.send(
							JSON.stringify({
								action: 'proxy.error',
								message: 'Could not authenticate MAI Realtime.',
							}),
						)
						client.close(1008, 'MAI identity unavailable')
					}
					return
				}
				if (closed || clientClosed || client.readyState !== WebSocket.OPEN) return

				try {
					upstream = createUpstream(`wss://${options.host}${UPSTREAM_PATH}`, {
						headers: authHeaders,
					})
				} catch (error) {
					options.onError?.(error instanceof Error ? error : new Error(String(error)))
					if (!clientClosed && client.readyState === WebSocket.OPEN) {
						client.send(
							JSON.stringify({
								action: 'proxy.error',
								message: 'Could not connect to MAI Realtime.',
							}),
						)
						client.close(1011, 'MAI upstream unavailable')
					}
					return
				}

				upstreams.add(upstream)
				const activeUpstream = upstream
				activeUpstream.on('open', () => {
					if (closed || clientClosed || activeUpstream.readyState !== WebSocket.OPEN) return
					for (const [data, isBinary] of backlog.splice(0)) {
						activeUpstream.send(data, { binary: isBinary })
					}
					backlogBytes = 0
				})
				activeUpstream.on('message', (data, isBinary) => {
					if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
				})
				activeUpstream.on('error', (error) => {
					options.onError?.(error)
					if (client.readyState === WebSocket.OPEN) client.close(1011, 'MAI upstream unavailable')
				})
				activeUpstream.on('close', (code, reason) => {
					upstreams.delete(activeUpstream)
					if (client.readyState === WebSocket.OPEN) {
						const safeCode =
							code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1011
						client.close(safeCode, reason.toString().slice(0, 120))
					}
				})
			})()
		})
	}

	return {
		upgrade,
		close() {
			closed = true
			for (const upstream of upstreams) upstream.terminate()
			for (const client of wss.clients) client.terminate()
			wss.close()
		},
	}
}

export function maiRealtimeProxy(options: MaiProxyOptions): Plugin {
	const attach = (server: ViteDevServer | PreviewServer) => {
		server.middlewares.use(MAI_CONFIG_PATH, (_req, res) => {
			res.setHeader('content-type', 'application/json')
			res.end(
				JSON.stringify({
					host: options.host,
					deployment: options.deployment,
					localPath: MAI_LOCAL_PATH,
				}),
			)
		})

		const proxy = createMaiProxy({
			...options,
			onError(error) {
				options.onError?.(error)
				server.config.logger.error(`[mai] upstream: ${error.message}`)
			},
		})
		server.httpServer?.on('upgrade', proxy.upgrade)
		server.httpServer?.once('close', () => {
			server.httpServer?.off('upgrade', proxy.upgrade)
			proxy.close()
		})
	}

	return {
		name: 'mico-mai-realtime-proxy',
		configureServer: attach,
		configurePreviewServer: attach,
	}
}
