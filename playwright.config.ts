import { defineConfig } from '@playwright/test'

const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? 'chromium' : 'chrome')

export default defineConfig({
	testDir: './tests/browser',
	fullyParallel: false,
	workers: 3,
	timeout: 15000,
	globalTimeout: 900000,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		channel,
		viewport: { width: 1440, height: 960 },
		contextOptions: { reducedMotion: 'reduce' },
		launchOptions: { args: ['--use-mock-keychain', '--disable-sync'] },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: {
				viewport: { width: 1440, height: 960 },
			},
		},
	],
})
