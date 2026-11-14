import { expect, test } from '@playwright/test'
import { openAssistant, resetBoard } from './support'

async function mockRuntime(page: Parameters<typeof openAssistant>[0], mossEnabled: boolean) {
	await page.route('**/api/runtime', (route) =>
		route.fulfill({
			json: {
				auth: { mode: 'none' },
				aiEnabled: true,
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
		page.on('request', (request) => {
			const url = new URL(request.url())
			if (url.pathname.startsWith('/api/moss/') || url.pathname.startsWith('/moss/')) {
				mossRequests++
			}
		})
		await page.route('**/api/moss/**', (route) => route.abort())
		await page.routeWebSocket(/\/moss\/(?:live|realtime)(?:\?.*)?$/, (socket) => socket.close())

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
		await expect(settings.getByRole('status')).toContainText('No API key required')
		await expect(settings.getByLabel('Endpoint')).toBeDisabled()
		await expect(settings.getByLabel('Model', { exact: true })).toBeDisabled()
		await expect(settings.getByLabel('API key', { exact: true })).toHaveCount(0)
		await expect(settings.getByRole('button', { name: 'Save settings' })).toBeDisabled()
		expect(mossRequests).toBe(0)
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
