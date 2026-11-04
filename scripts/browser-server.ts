import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, loadEnv } from 'vite'
import { createMockAiModel } from '../src/server/aiMock.ts'
import { createDaemon } from '../src/server/index.ts'
import { maiRealtimeProxy } from '../src/server/maiProxy.ts'
import { BROWSER_PORT } from '../src/shared/config.ts'
import { micoViteConfig } from '../vite.config.ts'

const directory = mkdtempSync(join(tmpdir(), 'mico-browser-'))
const port = BROWSER_PORT + 30000
const daemon = createDaemon({
	port,
	dbPath: join(directory, 'board.sqlite'),
	settingsPath: join(directory, 'ai-settings', 'settings.json'),
	aiModel: process.env.MICO_AI_MOCK === '1' ? createMockAiModel() : undefined,
})
const base = micoViteConfig()
const env = loadEnv('development', process.cwd(), '')
const plugins = [
	...base.plugins,
	maiRealtimeProxy({
		host: env.AZURE_MAI_HOST ?? '',
		apiKey: env.AZURE_OPENAI_API_KEY ?? '',
		deployment: env.AZURE_OPENAI_DEPLOYMENT ?? '',
	}),
]
const vite = await createServer({
	...base,
	plugins,
	configFile: false,
	cacheDir: join(directory, 'vite-cache'),
	server: {
		...base.server,
		port: BROWSER_PORT,
		proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true, ws: true } },
	},
})

let stopping = false
const shutdown = async () => {
	if (stopping) return
	stopping = true
	await vite.close()
	for (const client of daemon.wss.clients) client.terminate()
	daemon.close()
	rmSync(directory, { recursive: true, force: true })
}

process.on('SIGINT', () => void shutdown().then(() => process.exit(0)))
process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)))

try {
	daemon.server.listen(port, '127.0.0.1')
	await once(daemon.server, 'listening')
	await vite.listen()
	console.log(`Browser fixture listening on http://127.0.0.1:${BROWSER_PORT}`)
} catch (error) {
	await shutdown()
	throw error
}
