import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { maiRealtimeProxy } from './src/server/maiProxy.ts'
import { mossRealtimeProxy } from './src/server/mossProxy.ts'
import { DAEMON_PORT, DEV_HOST, DEV_PORT } from './src/shared/config.ts'

export function micoViteConfig() {
	return {
		plugins: [react()],
		server: {
			host: '127.0.0.1',
			port: DEV_PORT,
			strictPort: true,
			allowedHosts: [DEV_HOST],
			proxy: {
				'/api': {
					target: `http://127.0.0.1:${process.env.MICO_PORT || DAEMON_PORT}`,
					changeOrigin: true,
					ws: true,
				},
			},
		},
	}
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '')
	const host = env.AZURE_MAI_HOST
	const apiKey = env.AZURE_OPENAI_API_KEY
	const deployment = env.AZURE_OPENAI_DEPLOYMENT
	const mossApiKey = env.MOSS_API_KEY
	if (!host || !apiKey || !deployment) {
		console.warn('[mai] AZURE_MAI_HOST, AZURE_OPENAI_API_KEY or AZURE_OPENAI_DEPLOYMENT is missing')
	}
	if (!mossApiKey) {
		console.warn('[moss] MOSS_API_KEY is missing')
	}
	const base = micoViteConfig()
	return {
		...base,
		plugins: [
			...base.plugins,
			maiRealtimeProxy({
				host: host ?? '',
				apiKey: apiKey ?? '',
				deployment: deployment ?? '',
			}),
			mossRealtimeProxy({ apiKey: mossApiKey ?? '' }),
		],
	}
})
