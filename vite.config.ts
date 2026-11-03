import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { DAEMON_PORT, DEV_HOST, DEV_PORT } from './src/shared/config.ts'

export default defineConfig({
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
})
