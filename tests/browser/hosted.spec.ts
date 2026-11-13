import { expect, test } from '@playwright/test'

const runtime = (
	mode: 'none' | 'entra' = 'none',
	options: { aiEnabled?: boolean; ephemeral?: boolean } = {},
) => ({
	auth:
		mode === 'entra'
			? {
					mode,
					clientId: 'browser-test-client',
					authority: 'https://login.microsoftonline.com/common',
					redirectUri: 'http://127.0.0.1:27063/auth/callback',
				}
			: { mode },
	aiEnabled: options.aiEnabled ?? true,
	ephemeral: options.ephemeral ?? false,
})

async function mockRuntime(
	page: import('@playwright/test').Page,
	value: ReturnType<typeof runtime>,
) {
	await page.route('**/api/runtime', (route) =>
		route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) }),
	)
}

async function mockSession(
	page: import('@playwright/test').Page,
	status: number,
	body: unknown = { user: null },
) {
	await page.route('**/api/auth/session', (route) =>
		route.fulfill({
			status,
			contentType: 'application/json',
			body: status === 204 ? '' : JSON.stringify(body),
		}),
	)
}

test('runtime bootstrap failure closes the canvas', async ({ page }) => {
	await page.route('**/api/runtime', (route) => route.fulfill({ status: 503, body: '' }))
	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Mico could not start' })).toBeVisible()
	await expect(page.locator('.app')).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
})

test('auth none mounts the laptop app without sign-in chrome', async ({ page }) => {
	await mockRuntime(page, runtime('none'))
	await mockSession(page, 200, { user: null })
	await page.goto('/')
	await expect(page.locator('.app')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
	await expect(page.getByText('Preview', { exact: true })).toHaveCount(0)
})

test('auth required shows explicit login and never mounts the app', async ({ page }) => {
	await mockRuntime(page, runtime('entra'))
	await mockSession(page, 401)
	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Sign in to Mico' })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible()
	await expect(page.locator('.app')).toHaveCount(0)
	await page.goto('/login')
	await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible()
})

test('callback failure is retryable and never renders the app', async ({ page }) => {
	await mockRuntime(page, runtime('entra'))
	await mockSession(page, 401)
	await page.goto('/auth/callback?error=access_denied&error_description=User+cancelled')
	await expect(page.getByRole('heading', { name: 'Could not finish sign-in' })).toBeVisible()
	await expect(page.getByText(/User cancelled/)).toBeVisible()
	await expect(page.getByRole('button', { name: 'Try Microsoft sign-in again' })).toBeVisible()
	await expect(page.locator('.app')).toHaveCount(0)
})

test('AI disabled preview supports manual drawing with no assistant or provider requests', async ({
	page,
}) => {
	await mockRuntime(page, runtime('none', { aiEnabled: false, ephemeral: true }))
	await mockSession(page, 200, { user: null })
	await page.addInitScript(() => {
		Object.assign(globalThis, { __micoProviderRequests: 0 })
		const media = navigator.mediaDevices
		if (media) {
			media.getUserMedia = () => {
				Object.assign(globalThis, { __micoProviderRequests: 1 })
				return Promise.reject(new DOMException('Microphone disabled', 'NotAllowedError'))
			}
		}
	})
	await page.route('**/api/ai/**', (route) => {
		void page.evaluate(() => {
			Object.assign(globalThis, { __micoProviderRequests: 1 })
		})
		return route.abort()
	})
	await page.route('**/mai/**', (route) => route.abort())
	await page.route('**/moss/**', (route) => route.abort())
	await page.goto('/?ai=draw%20a%20lesson')
	await expect(page.locator('.app')).toBeVisible()
	await expect(page.getByText('AI unavailable', { exact: true })).toBeVisible()
	await expect(page.getByText('Preview', { exact: true })).toBeVisible()
	await expect(page.getByText('Data may disappear', { exact: true })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Open AI assistant' })).toHaveCount(0)
	const noteTool = page.getByRole('button', { name: 'Sticky note', exact: true })
	await noteTool.click()
	await expect(noteTool).toHaveAttribute('aria-pressed', 'true')
	await page.locator('.canvas').click({ position: { x: 260, y: 220 } })
	expect(
		await page.evaluate(
			() =>
				(globalThis as typeof globalThis & { __micoProviderRequests: number })
					.__micoProviderRequests,
		),
	).toBe(0)
})

test('logout clears the server view and returns to login', async ({ page }) => {
	await mockRuntime(page, runtime('entra'))
	let authenticated = true
	await page.route('**/api/auth/session', (route) =>
		route.fulfill({
			status: authenticated ? 200 : 401,
			contentType: 'application/json',
			body: authenticated
				? JSON.stringify({
						user: { name: 'Ada', expiresAt: Math.floor(Date.now() / 1000) + 3600 },
					})
				: JSON.stringify({ user: null }),
		}),
	)
	await page.route('**/api/auth/logout', (route) => {
		authenticated = false
		return route.fulfill({ status: 204, body: '' })
	})
	await page.goto('/')
	await expect(page.locator('.app')).toBeVisible()
	await page.getByRole('button', { name: 'Sign out' }).click()
	await expect(page.getByRole('heading', { name: 'Sign in to Mico' })).toBeVisible()
	await expect(page.locator('.app')).toHaveCount(0)
})

test('expired server sessions return to login', async ({ page }) => {
	await mockRuntime(page, runtime('entra'))
	await mockSession(page, 200, {
		user: { name: 'Ada', expiresAt: 1 },
	})
	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Sign in to Mico' })).toBeVisible()
	await expect(page.locator('.app')).toHaveCount(0)
})
