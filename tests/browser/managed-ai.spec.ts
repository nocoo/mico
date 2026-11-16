import { expect, test } from '@playwright/test'
import { openAssistant, resetBoard } from './support'

async function mockRuntime(
	page: Parameters<typeof openAssistant>[0],
	mossEnabled: boolean,
	aiSettingsVisible = true,
) {
	await page.route('**/api/runtime', (route) =>
		route.fulfill({
			json: {
				auth: { mode: 'none' },
				aiEnabled: true,
				aiSettingsVisible,
				mossEnabled,
				ephemeral: false,
			},
		}),
	)
}

async function mockManagedSettings(page: Parameters<typeof openAssistant>[0]) {
	await page.route('**/api/ai/settings', (route) => {
		if (route.request().method() !== 'GET') {
			void route.fulfill({ status: 403, json: { error: 'AI_SETTINGS_READ_ONLY' } })
			return
		}
		void route.fulfill({
			json: {
				baseURL: 'https://deployment.example.test/v1',
				model: 'deployment/model',
				hasApiKey: false,
				readOnly: true,
				authMode: 'managed-identity',
			},
		})
	})
}

test.describe('managed AI runtime', () => {
	test.beforeEach(async ({ request }) => {
		await resetBoard(request, [])
	})

	test('managed identity is readonly and disables MOSS for pointer and keyboard', async ({
		page,
	}) => {
		await mockRuntime(page, false)
		await mockManagedSettings(page)

		let mossRequests = 0
		let mossSockets = 0
		page.on('request', (request) => {
			const url = new URL(request.url())
			if (url.pathname.startsWith('/api/moss/') || url.pathname === '/moss') {
				mossRequests++
			}
		})
		await page.route('**/api/moss/**', (route) => route.abort())
		await page.routeWebSocket(/\/moss(?:\?.*)?$/, (socket) => {
			mossSockets++
			socket.close()
		})

		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

		const live = await openAssistant(page, 'Live')
		const mai = live.getByRole('radio', { name: 'MAI Transcribe' })
		const moss = live.getByRole('radio', { name: 'MOSS Live' })
		await expect(mai).toHaveAttribute('data-state', 'on')
		await expect(moss).toHaveAttribute('data-state', 'off')
		await expect(moss).toHaveAttribute('aria-disabled', 'true')
		await expect(moss).toHaveAttribute('tabindex', '-1')
		await expect(live.getByRole('button', { name: 'Start recording' })).toBeVisible()

		await moss.click({ force: true })
		await expect(moss).toHaveAttribute('data-state', 'off')
		await expect(mai).toHaveAttribute('data-state', 'on')
		await mai.focus()
		await page.keyboard.press('ArrowLeft')
		await expect(moss).toBeFocused()
		await page.keyboard.press('Tab')
		await expect(moss).not.toBeFocused()
		await mai.focus()
		await page.keyboard.press('ArrowLeft')
		await expect(moss).toBeFocused()
		await page.keyboard.press('Shift+Tab')
		await expect(moss).not.toBeFocused()
		await mai.focus()
		await page.keyboard.press('ArrowLeft')
		await page.keyboard.press('ArrowRight')
		await expect(mai).toBeFocused()
		await moss.focus()
		await page.keyboard.press('Enter')
		await page.keyboard.press('Space')
		await expect(moss).toHaveAttribute('data-state', 'off')
		await expect(mai).toHaveAttribute('data-state', 'on')
		expect(mossRequests).toBe(0)

		await live.getByRole('tab', { name: 'Chat' }).click()
		await expect(live.getByRole('textbox', { name: 'Message the assistant' })).toBeEnabled()

		await live.getByRole('tab', { name: 'Settings' }).click()
		const settings = live.getByRole('tabpanel', { name: 'Settings' })
		await expect(settings.getByRole('status')).toContainText('Managed identity')
		await expect(settings.getByRole('status')).toContainText('no API key required')
		await expect(settings.getByLabel('Endpoint')).toBeDisabled()
		await expect(settings.getByLabel('Model', { exact: true })).toBeDisabled()
		await expect(settings.getByLabel('API key', { exact: true })).toHaveCount(0)
		await expect(settings.getByRole('button', { name: 'Save settings' })).toBeDisabled()
		expect(mossRequests).toBe(0)
		expect(mossSockets).toBe(0)
	})

	test('deployment hides Settings and keeps keyboard navigation on visible tabs', async ({
		page,
	}, testInfo) => {
		await mockRuntime(page, false, false)
		let settingsRequests = 0
		page.on('request', (request) => {
			if (['/api/ai/settings', '/api/ai/models'].includes(new URL(request.url()).pathname))
				settingsRequests++
		})
		await page.route('**/api/ai/settings', (route) => route.abort())
		await page.route('**/api/ai/models', (route) => route.abort())
		await page.goto('/')
		const panel = await openAssistant(page, 'Chat')
		await expect(panel.getByRole('tab')).toHaveText(['Chat', 'Audio', 'Live'])
		await expect(panel.getByRole('tab', { name: 'Settings' })).toHaveCount(0)
		await expect(page.locator('#ai-panel-settings')).toHaveCount(0)
		const chat = panel.getByRole('tab', { name: 'Chat', exact: true })
		const live = panel.getByRole('tab', { name: 'Live', exact: true })
		await chat.focus()
		await page.keyboard.press('End')
		await expect(live).toBeFocused()
		await expect(live).toHaveAttribute('aria-selected', 'true')
		await page.keyboard.press('ArrowRight')
		await expect(chat).toBeFocused()
		await page.keyboard.press('ArrowLeft')
		await expect(live).toBeFocused()
		await page.keyboard.press('Home')
		await expect(chat).toBeFocused()
		await page.screenshot({
			path: testInfo.outputPath('deployment-tabs.png'),
			animations: 'disabled',
		})
		await page.route('**/api/ai/chat', (route) =>
			route.fulfill({ status: 503, json: { error: 'PROVIDER_UNAVAILABLE' } }),
		)
		const composer = panel.getByRole('textbox', { name: 'Message the assistant' })
		await composer.fill('Draw a test label')
		await composer.press('Enter')
		await expect(panel.getByRole('alert')).toContainText('deployment administrator')
		await expect(panel.getByRole('alert')).not.toContainText('Settings')
		expect(settingsRequests).toBe(0)
	})

	test('local runtime keeps MOSS enabled and selected by default', async ({ page }) => {
		await mockRuntime(page, true)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

		const live = await openAssistant(page, 'Live')
		const moss = live.getByRole('radio', { name: 'MOSS Live' })
		const mai = live.getByRole('radio', { name: 'MAI Transcribe' })
		await expect(moss).toHaveAttribute('data-state', 'on')
		await expect(moss).toHaveAttribute('aria-disabled', 'false')
		await expect(mai).toHaveAttribute('data-state', 'off')
		await mai.click()
		await expect(mai).toHaveAttribute('data-state', 'on')
		await moss.click()
		await expect(moss).toHaveAttribute('data-state', 'on')
	})
})
