import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { createMockAiModel } from '../src/server/aiMock.ts'
import { createDaemon } from '../src/server/index.ts'
import { BROWSER_PORT } from '../src/shared/config.ts'
import viteConfig from '../vite.config.ts'

const directory = mkdtempSync(join(tmpdir(), 'mico-browser-'))
const port = BROWSER_PORT + 30000
const daemon = createDaemon({
	port,
	dbPath: join(directory, 'board.sqlite'),
	aiModel: process.env.MICO_AI_MOCK === '1' ? createMockAiModel() : undefined,
})
const vite = await createServer({
	...viteConfig,
	configFile: false,
	cacheDir: join(directory, 'vite-cache'),
	server: {
		...viteConfig.server,
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
