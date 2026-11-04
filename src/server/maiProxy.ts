import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Plugin, ViteDevServer } from 'vite'
import WebSocket, { WebSocketServer } from 'ws'

const UPSTREAM_PATH = '/mai/v1/realtime?intent=transcription'
export const MAI_LOCAL_PATH = '/mai/realtime'
export const MAI_CONFIG_PATH = '/mai/config'

interface MaiProxyOptions {
	host: string
	apiKey: string
	deployment: string
}

export function maiRealtimeProxy({ host, apiKey, deployment }: MaiProxyOptions): Plugin {
	const upstreamUrl = `wss://${host}${UPSTREAM_PATH}`
	return {
		name: 'mico-mai-realtime-proxy',
		configureServer(server: ViteDevServer) {
			server.middlewares.use(MAI_CONFIG_PATH, (_req, res) => {
				res.setHeader('content-type', 'application/json')
				res.end(JSON.stringify({ host, deployment, localPath: MAI_LOCAL_PATH }))
			})

			const wss = new WebSocketServer({ noServer: true })
			wss.on('connection', (client) => {
				const upstream = new WebSocket(upstreamUrl, { headers: { 'api-key': apiKey } })
				const backlog: [WebSocket.RawData, boolean][] = []

				const pipe = (data: WebSocket.RawData, isBinary: boolean) => {
					if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
					else if (upstream.readyState === WebSocket.CONNECTING) backlog.push([data, isBinary])
				}

				client.on('message', pipe)
				upstream.on('open', () => {
					for (const [data, isBinary] of backlog.splice(0))
						upstream.send(data, { binary: isBinary })
				})
				upstream.on('message', (data, isBinary) => {
					if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
				})
				upstream.on('error', (error) => {
					server.config.logger.error(`[mai] upstream: ${error.message}`)
					if (client.readyState === WebSocket.OPEN) client.close(1011, error.message.slice(0, 120))
				})
				upstream.on('close', (code, reason) => {
					if (client.readyState === WebSocket.OPEN) {
						client.close(code === 1005 ? 1000 : code, reason.toString().slice(0, 120))
					}
				})
				client.on('close', () => upstream.close())
				client.on('error', () => upstream.terminate())
			})

			const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
				const { pathname } = new URL(req.url ?? '/', 'http://localhost')
				if (pathname !== MAI_LOCAL_PATH) return
				wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client))
			}
			server.httpServer?.on('upgrade', onUpgrade)
			server.httpServer?.once('close', () => {
				server.httpServer?.off('upgrade', onUpgrade)
				wss.close()
			})
		},
	}
}
