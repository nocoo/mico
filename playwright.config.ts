import { defineConfig } from '@playwright/test'
import { BROWSER_PORT } from './src/shared/config.ts'

const baseURL = `http://127.0.0.1:${BROWSER_PORT}`

export default defineConfig({
	testDir: './tests/browser',
	fullyParallel: false,
	workers: 1,
	timeout: 15000,
	globalTimeout: 120000,
	reporter: 'list',
	use: {
		baseURL,
		channel: 'chrome',
		viewport: { width: 1440, height: 960 },
		launchOptions: { args: ['--use-mock-keychain', '--disable-sync'] },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	webServer: {
		command: 'node scripts/browser-server.ts',
		url: `${baseURL}/api/live`,
		reuseExistingServer: false,
		timeout: 20000,
		env: { MICO_AI_MOCK: '1' },
	},
})
