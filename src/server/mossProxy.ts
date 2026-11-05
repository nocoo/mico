import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import WebSocket, { WebSocketServer } from 'ws'
import { ALLOWED_ORIGINS, DEV_HOST } from '../shared/config.ts'

export const MOSS_LOCAL_PATH = '/moss'
export const MOSS_UPSTREAM_URL = 'wss://api.mosi.cn/v1/realtime?model=moss-live-1.0'
export const MOSS_MAX_PAYLOAD = 1024 * 1024
export const MOSS_MAX_BUFFERED_BYTES = 4 * 1024 * 1024

export interface MossUpstreamOptions {
	headers: { Authorization: string }
	maxPayload: number
}

export type MossUpstreamFactory = (url: string, options: MossUpstreamOptions) => WebSocket

export interface MossRealtimeProxyOptions {
	apiKey: string
	createUpstream?: MossUpstreamFactory
	maxPayload?: number
	maxBufferedBytes?: number
}

export function isMossUpgradeAllowed(
	originHeader: string | undefined,
	hostHeader: string | undefined,
): boolean {
	if (!originHeader || !hostHeader) return false
	let origin: URL
	try {
		origin = new URL(originHeader)
	} catch {
		return false
	}
	if (origin.host !== hostHeader || !ALLOWED_ORIGINS.has(origin.origin)) return false
	if (origin.protocol === 'https:') return origin.hostname === DEV_HOST
	if (origin.protocol === 'http:')
		return origin.hostname === '127.0.0.1' || origin.hostname === 'localhost'
	return false
}

export function forwardMossFrame(
	target: WebSocket,
	data: WebSocket.RawData,
	isBinary: boolean,
	maxBufferedBytes: number,
): boolean {
	if (target.readyState !== WebSocket.OPEN) return false
	if (target.bufferedAmount >= maxBufferedBytes) return false
	try {
		target.send(data, { binary: isBinary })
		return true
	} catch {
		return false
	}
}

export function pipeMossSockets(
	client: WebSocket,
	upstream: WebSocket,
	maxBufferedBytes = MOSS_MAX_BUFFERED_BYTES,
): void {
	const closePair = (code = 1011): void => {
		if (client.readyState === WebSocket.OPEN) client.close(code, 'MOSS proxy stopped')
		if (upstream.readyState === WebSocket.CONNECTING || upstream.readyState === WebSocket.OPEN) {
			upstream.close()
		} else if (upstream.readyState === WebSocket.CLOSING) {
			upstream.terminate()
		}
	}

	client.on('message', (data, isBinary) => {
		if (!forwardMossFrame(upstream, data, isBinary, maxBufferedBytes)) {
			if (upstream.readyState === WebSocket.OPEN) closePair(1013)
		}
	})
	upstream.on('message', (data, isBinary) => {
		if (!forwardMossFrame(client, data, isBinary, maxBufferedBytes)) {
			if (client.readyState === WebSocket.OPEN) closePair(1013)
		}
	})
	upstream.on('error', () => {
		if (client.readyState === WebSocket.OPEN) {
			client.send(
				JSON.stringify({ action: 'proxy.error', message: 'Could not connect to MOSS Live.' }),
			)
			client.close(1011, 'MOSS upstream unavailable')
		}
		upstream.terminate()
	})
	upstream.on('close', (code) => {
		if (client.readyState !== WebSocket.OPEN) return
		const safeCode =
			code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1011
		client.close(safeCode, 'MOSS upstream closed')
	})
	client.on('error', () => upstream.terminate())
	client.on('close', () => {
		if (upstream.readyState === WebSocket.CONNECTING || upstream.readyState === WebSocket.OPEN) {
			upstream.close()
		}
	})
}

export function mossRealtimeProxy(options: MossRealtimeProxyOptions): Plugin {
	const maxPayload = options.maxPayload ?? MOSS_MAX_PAYLOAD
	const maxBufferedBytes = options.maxBufferedBytes ?? MOSS_MAX_BUFFERED_BYTES
	const createUpstream =
		options.createUpstream ?? ((url, upstreamOptions) => new WebSocket(url, upstreamOptions))

	const attach = (server: ViteDevServer | PreviewServer) => {
		const wss = new WebSocketServer({ noServer: true, maxPayload })

		const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
			let pathname: string
			try {
				pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
			} catch {
				socket.destroy()
				return
			}
			if (pathname !== MOSS_LOCAL_PATH) return
			if (!isMossUpgradeAllowed(req.headers.origin, req.headers.host)) {
				socket.destroy()
				return
			}

			wss.handleUpgrade(req, socket, head, (client) => {
				if (!options.apiKey) {
					client.send(
						JSON.stringify({
							action: 'proxy.error',
							message: 'MOSS_API_KEY is missing from server environment',
						}),
					)
					client.close(1008, 'MOSS key unavailable')
					return
				}

				let upstream: WebSocket
				try {
					upstream = createUpstream(MOSS_UPSTREAM_URL, {
						headers: { Authorization: `Bearer ${options.apiKey}` },
						maxPayload,
					})
				} catch {
					client.send(
						JSON.stringify({ action: 'proxy.error', message: 'Could not connect to MOSS Live.' }),
					)
					client.close(1011, 'MOSS upstream unavailable')
					return
				}

				pipeMossSockets(client, upstream, maxBufferedBytes)
				upstream.on('open', () => {
					if (client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify({ action: 'proxy.ready' }))
					}
				})
			})
		}

		server.httpServer?.on('upgrade', onUpgrade)
		server.httpServer?.once('close', () => {
			server.httpServer?.off('upgrade', onUpgrade)
			wss.close()
		})
	}

	return {
		name: 'mico-moss-realtime-proxy',
		configureServer: attach,
		configurePreviewServer: attach,
	}
}
