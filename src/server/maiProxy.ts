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
	createUpstream?: (url: string, options: { headers: { 'api-key': string } }) => WebSocket
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
		if (!isMossUpgradeAllowed(req.headers.origin, req.headers.host)) {
			socket.destroy()
			return
		}

		wss.handleUpgrade(req, socket, head, (client) => {
			client.on('error', () => client.terminate())

			if (!options.host || !options.apiKey || !options.deployment) {
				client.send(
					JSON.stringify({
						action: 'proxy.error',
						message: 'MAI credentials are missing from server environment',
					}),
				)
				client.close(1008, 'MAI config unavailable')
				return
			}

			let upstream: WebSocket
			try {
				upstream = createUpstream(`wss://${options.host}${UPSTREAM_PATH}`, {
					headers: { 'api-key': options.apiKey },
				})
			} catch (error) {
				options.onError?.(error instanceof Error ? error : new Error(String(error)))
				client.send(
					JSON.stringify({ action: 'proxy.error', message: 'Could not connect to MAI Realtime.' }),
				)
				client.close(1011, 'MAI upstream unavailable')
				return
			}

			upstreams.add(upstream)
			const backlog: [WebSocket.RawData, boolean][] = []
			client.on('message', (data, isBinary) => {
				if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
				else if (upstream.readyState === WebSocket.CONNECTING) backlog.push([data, isBinary])
			})
			upstream.on('open', () => {
				for (const [data, isBinary] of backlog.splice(0)) {
					upstream.send(data, { binary: isBinary })
				}
			})
			upstream.on('message', (data, isBinary) => {
				if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
			})
			upstream.on('error', (error) => {
				options.onError?.(error)
				if (client.readyState === WebSocket.OPEN) client.close(1011, 'MAI upstream unavailable')
			})
			upstream.on('close', (code, reason) => {
				upstreams.delete(upstream)
				if (client.readyState === WebSocket.OPEN) {
					const safeCode =
						code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1011
					client.close(safeCode, reason.toString().slice(0, 120))
				}
			})
			client.on('close', () => {
				if (
					upstream.readyState === WebSocket.CONNECTING ||
					upstream.readyState === WebSocket.OPEN
				) {
					upstream.close()
				}
			})
			client.on('error', () => upstream.terminate())
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
