import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { loadAiConfig, runtimeMode } from './src/server/aiConfig.ts'
import { maiRealtimeProxy } from './src/server/maiProxy.ts'
import { createManagedIdentityAuth } from './src/server/managedIdentity.ts'
import { mossRealtimeProxy } from './src/server/mossProxy.ts'
import { DAEMON_PORT, DEV_HOST, DEV_PORT } from './src/shared/config.ts'
import { isMossEnabled } from './src/shared/runtime.ts'

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
	const runtime = runtimeMode()
	const env = runtime === 'deploy' ? process.env : loadEnv(mode, process.cwd(), '')
	if (runtimeMode(env) !== runtime) {
		throw new Error('MICO_RUNTIME=deploy must be set in the process environment')
	}
	const config = loadAiConfig(env)
	const identity =
		config.authMode === 'managed-identity' && config.chat.baseURL
			? createManagedIdentityAuth(config.azureClientId as string)
			: undefined
	if (!config.mai.host || (!config.mai.apiKey && !identity) || !config.mai.deployment) {
		console.warn('[mai] AZURE_MAI_HOST, AZURE_OPENAI_API_KEY or AZURE_OPENAI_DEPLOYMENT is missing')
	}
	if (isMossEnabled(env) && !config.moss.apiKey) {
		console.warn('[moss] MOSS_API_KEY is missing')
	}
	const base = micoViteConfig()
	return {
		...base,
		envDir: runtime === 'deploy' ? false : undefined,
		plugins: [
			...base.plugins,
			maiRealtimeProxy({ ...config.mai, bearerProvider: identity?.maiBearer }),
			mossRealtimeProxy({ ...config.moss, enabled: isMossEnabled(env) }),
		],
	}
})
