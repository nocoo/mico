import { expect } from '@playwright/test'
import { ISOLATED_ORIGIN, openAssistant, test } from './support'

const runtime = (
	mode: 'none' | 'entra' = 'none',
	options: { aiEnabled?: boolean; mossEnabled?: boolean; ephemeral?: boolean } = {},
	origin = ISOLATED_ORIGIN,
) => ({
	auth:
		mode === 'entra'
			? {
					mode,
					clientId: 'browser-test-client',
					tenantId: 'browser-test-tenant',
					authority: 'https://login.microsoftonline.com/browser-test-tenant',
					redirectUri: `${origin}/auth/callback`,
				}
			: { mode },
	aiEnabled: options.aiEnabled ?? true,
	aiSettingsVisible: true,
	mossEnabled: options.mossEnabled ?? true,
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

async function mockMsal(
	page: import('@playwright/test').Page,
	redirectResult: { idToken?: string; account?: { homeAccountId: string } } | null,
) {
	await page.route(/\/(@azure_msal-browser|assets\/dist-[^/]+)\.js(?:\?|$)/, (route) =>
		route.fulfill({
			contentType: 'application/javascript',
			body: `
			const result = ${JSON.stringify(redirectResult)};
			const record = (key, value) => sessionStorage.setItem('test-msal-' + key, String(value));
			const count = (key) => record(key, Number(sessionStorage.getItem('test-msal-' + key) || 0) + 1);
			export class PublicClientApplication {
				async initialize() { count('initialize'); }
				async handleRedirectPromise(options) {
					count('redirect');
					record('navigate', options.navigateToLoginRequestUrl);
					return result;
				}
				async loginRedirect() {}
				async clearCache() { count('clear'); }
				setActiveAccount() {}
				getAllAccounts() { return result?.account ? [result.account] : []; }
				getActiveAccount() { return result?.account ?? null; }
				async acquireTokenSilent() { return result ?? { idToken: '' }; }
			}
		`,
		}),
	)
}

test('auth required shows explicit login and never mounts the app', async ({ page, baseURL }) => {
	await mockRuntime(page, runtime('entra', {}, baseURL))
	await mockSession(page, 401)
	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Sign in to Mico' })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible()
	await expect(page.locator('.app')).toHaveCount(0)
	await page.goto('/login')
	await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible()
})

test('successful callback posts the ID token once and mounts only after session verification', async ({
	page,
	baseURL,
}) => {
	await mockRuntime(page, runtime('entra', {}, baseURL))
	await mockMsal(page, {
		idToken: 'mock-id-token',
		account: { homeAccountId: 'browser-account' },
	})
	let sessionPosts = 0
	await page.route('**/api/auth/session', (route) => {
		if (route.request().method() === 'POST') {
			sessionPosts++
			if (JSON.parse(route.request().postData() ?? '{}').id_token !== 'mock-id-token') {
				return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' })
			}
			return route.fulfill({ status: 204, body: '' })
		}
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { name: 'Ada', expiresAt: Date.now() + 3600000 },
			}),
		})
	})
	await page.goto('/auth/callback?code=mock-code&state=mock-state')
	await expect(page.locator('.app')).toBeVisible()
	await page.getByRole('button', { name: 'Debug' }).click()
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
	expect(sessionPosts).toBe(1)
	const calls = await page.evaluate(() => ({
		redirect: Number(sessionStorage.getItem('test-msal-redirect')),
		navigate: sessionStorage.getItem('test-msal-navigate'),
		initialize: Number(sessionStorage.getItem('test-msal-initialize')),
	}))
	expect(calls.redirect).toBe(1)
	expect(calls.navigate).toBe('false')
	expect(calls.initialize).toBeGreaterThanOrEqual(1)
	await expect(page.locator('.app')).toBeVisible()
})

test('logout clears the server view and returns to login', async ({ page, baseURL }) => {
	await mockRuntime(page, runtime('entra', {}, baseURL))
	await mockMsal(page, null)
	let authenticated = true
	await page.route('**/api/auth/session', (route) =>
		route.fulfill({
			status: authenticated ? 200 : 401,
			contentType: 'application/json',
			body: authenticated
				? JSON.stringify({
						user: { name: 'Ada', expiresAt: Date.now() + 3600000 },
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
	await page.getByRole('button', { name: 'Debug' }).click()
	await page.getByRole('button', { name: 'Sign out' }).click()
	await expect(page.getByRole('heading', { name: 'Sign in to Mico' })).toBeVisible()
	await expect(page.locator('.app')).toHaveCount(0)
})

test('theme follows OS preference, honors URL overrides, and persists Settings choices', async ({
	page,
}) => {
	await mockRuntime(page, runtime('none'))
	await mockSession(page, 200, { user: null })

	await page.emulateMedia({ colorScheme: 'dark' })
	await page.goto('/?gate=loading&theme=dark')
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
	await expect(page.locator('.gate-screen')).toHaveCSS('color-scheme', 'dark')

	await page.goto('/')
	await expect(page.locator('.app')).toBeVisible()
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
	await expect(page.locator('.app')).toHaveCSS('color-scheme', 'dark')

	await page.emulateMedia({ colorScheme: 'light' })
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
	await expect(page.locator('.app')).toHaveCSS('color-scheme', 'light')

	await page.emulateMedia({ colorScheme: 'dark' })
	await page.goto('/?theme=light')
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

	await page.emulateMedia({ colorScheme: 'light' })
	await page.goto('/?theme=dark')
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

	const panel = await openAssistant(page, 'Settings')
	const settings = panel.getByRole('tabpanel', { name: 'Settings' })
	await expect(settings.getByRole('region', { name: 'Appearance' })).toBeVisible()
	await expect(settings.getByRole('separator')).toBeVisible()
	await expect(settings.getByRole('region', { name: 'AI Service' })).toBeVisible()

	const themeGroup = settings.getByRole('radiogroup', { name: 'Theme' })
	const darkRadio = themeGroup.getByRole('radio', { name: 'Dark' })
	const systemRadio = themeGroup.getByRole('radio', { name: 'System' })
	const lightRadio = themeGroup.getByRole('radio', { name: 'Light' })
	await expect(darkRadio).toBeChecked()

	await darkRadio.focus()
	await page.keyboard.press('ArrowRight')
	await expect(systemRadio).toBeFocused()
	await expect(systemRadio).toBeChecked()
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
	expect(new URL(page.url()).searchParams.get('theme')).toBeNull()

	await themeGroup.getByText('Light', { exact: true }).click()
	await expect(lightRadio).toBeChecked()
	await themeGroup.getByText('Dark', { exact: true }).click()
	await expect(darkRadio).toBeChecked()
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

	await page.reload()
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
	await openAssistant(page, 'Settings')
	await expect(darkRadio).toBeChecked()
})
