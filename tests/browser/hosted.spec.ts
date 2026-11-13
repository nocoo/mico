import { expect, test } from '@playwright/test'
import { board } from './support'

const runtime = (
	mode: 'none' | 'entra' = 'none',
	options: { aiEnabled?: boolean; ephemeral?: boolean } = {},
) => ({
	auth:
		mode === 'entra'
			? {
					mode,
					clientId: 'browser-test-client',
					tenantId: 'browser-test-tenant',
					authority: 'https://login.microsoftonline.com/browser-test-tenant',
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

async function mockMsal(
	page: import('@playwright/test').Page,
	redirectResult: { idToken?: string; account?: { homeAccountId: string } } | null,
) {
	await page.route(/\/@azure_msal-browser\.js(?:\?|$)/, (route) =>
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
	await mockMsal(page, null)
	await page.goto('/auth/callback?error=access_denied&error_description=User+cancelled')
	await expect(page.getByRole('heading', { name: 'Could not finish sign-in' })).toBeVisible()
	await expect(page.getByText(/User cancelled/)).toBeVisible()
	await expect(page.getByRole('button', { name: 'Try Microsoft sign-in again' })).toBeVisible()
	await expect(page.locator('.app')).toHaveCount(0)
})

test('successful callback posts the ID token once and mounts only after session verification', async ({
	page,
}) => {
	await mockRuntime(page, runtime('entra'))
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

test('a rejected redirect can start a fresh Microsoft sign-in on retry', async ({ page }) => {
	await mockRuntime(page, runtime('entra'))
	await mockSession(page, 401)
	await page.route(/\/@azure_msal-browser\.js(?:\?|$)/, (route) =>
		route.fulfill({
			contentType: 'application/javascript',
			body: `
			export class PublicClientApplication {
				constructor() {
					const count = Number(sessionStorage.getItem('test-instances') || 0) + 1;
					sessionStorage.setItem('test-instances', String(count));
					this.first = count === 1;
				}
				async initialize() {}
				handleRedirectPromise() {
					this.redirect ??= this.first ? Promise.reject(new Error('access_denied')) : Promise.resolve(null);
					return this.redirect;
				}
				async clearCache() {}
				async loginRedirect() { sessionStorage.setItem('test-login-started', location.pathname); }
			}
		`,
		}),
	)
	await page.goto('/auth/callback?error=access_denied')
	await expect(page.getByRole('heading', { name: 'Could not finish sign-in' })).toBeVisible()
	await page.getByRole('button', { name: 'Try Microsoft sign-in again' }).click()
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem('test-login-started')))
		.toBe('/login')
	expect(await page.evaluate(() => sessionStorage.getItem('test-instances'))).toBe('2')
})

test('AI disabled preview supports manual drawing with no assistant or provider requests', async ({
	page,
	request,
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
	let providerRequests = 0
	page.on('request', (candidate) => {
		const url = new URL(candidate.url()).pathname
		if (
			url.startsWith('/api/ai/') ||
			url.startsWith('/api/moss/') ||
			url.startsWith('/mai/') ||
			url === '/moss'
		) {
			providerRequests++
		}
	})
	page.on('websocket', (socket) => {
		const url = new URL(socket.url()).pathname
		if (url.startsWith('/mai/') || url === '/moss') providerRequests++
	})
	await page.goto('/?ai=draw%20a%20lesson')
	await expect(page.locator('.app')).toBeVisible()
	await expect(page.getByText('AI unavailable', { exact: true })).toBeVisible()
	await expect(page.getByText('Preview', { exact: true })).toBeVisible()
	await expect(page.getByText('Data may disappear', { exact: true })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Open AI assistant' })).toHaveCount(0)
	const noteTool = page.getByRole('button', { name: 'Sticky note', exact: true })
	await noteTool.click()
	await expect(noteTool).toHaveAttribute('aria-pressed', 'true')
	const before = await board(request)
	await page.locator('.canvas').click({ position: { x: 260, y: 220 } })
	await expect
		.poll(async () => {
			const next = await board(request)
			return next.shapes.some(
				(shape) => shape.type === 'note' && !before.shapes.some((old) => old.id === shape.id),
			)
		})
		.toBe(true)
	expect(
		await page.evaluate(
			() =>
				(globalThis as typeof globalThis & { __micoProviderRequests: number })
					.__micoProviderRequests,
		),
	).toBe(0)
	expect(providerRequests).toBe(0)
})

test('logout clears the server view and returns to login', async ({ page }) => {
	await mockRuntime(page, runtime('entra'))
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
	await page.getByRole('button', { name: 'Sign out' }).click()
	await expect(page.getByRole('heading', { name: 'Sign in to Mico' })).toBeVisible()
	await expect(page.locator('.app')).toHaveCount(0)
})

test('logout failure keeps the app unmounted and offers retry', async ({ page }) => {
	await mockRuntime(page, runtime('entra'))
	await mockMsal(page, null)
	await mockSession(page, 200, {
		user: { name: 'Ada', expiresAt: Date.now() + 3600000 },
	})
	await page.route('**/api/auth/logout', (route) =>
		route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
	)
	await page.goto('/')
	await expect(page.locator('.app')).toBeVisible()
	await page.getByRole('button', { name: 'Sign out' }).click()
	await expect(page.getByRole('heading', { name: 'Could not sign out' })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Try sign-out again' })).toBeVisible()
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
