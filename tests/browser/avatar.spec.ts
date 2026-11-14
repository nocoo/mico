import { expect, type Page, test } from '@playwright/test'

const PHOTO = 'https://graph.microsoft.com/v1.0/me/photos/96x96/$value'
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
	'base64',
)

async function signedIn(page: Page) {
	let authenticated = true
	await page.route('**/api/runtime', (route) =>
		route.fulfill({
			json: {
				auth: {
					mode: 'entra',
					clientId: 'avatar-fixture-client',
					tenantId: 'avatar-fixture-tenant',
					authority: 'https://login.microsoftonline.com/avatar-fixture-tenant',
					redirectUri: 'http://127.0.0.1:27063/auth/callback',
				},
				aiEnabled: false,
				mossEnabled: false,
				ephemeral: true,
			},
		}),
	)
	await page.route('**/api/auth/session', (route) =>
		route.fulfill({
			status: authenticated ? 200 : 401,
			json: {
				user: authenticated ? { name: 'Ada Canvas', expiresAt: Date.now() + 3600000 } : null,
			},
		}),
	)
	await page.route('**/api/auth/logout', (route) => {
		authenticated = false
		return route.fulfill({ status: 204 })
	})
	await page.route(/\/@azure_msal-browser\.js(?:\?|$)/, (route) =>
		route.fulfill({
			contentType: 'application/javascript',
			body: `
			export class PublicClientApplication {
				async initialize() {}
				async clearCache() {}
				getAllAccounts() { return [{ homeAccountId: 'avatar-fixture' }]; }
				getActiveAccount() { return null; }
				async acquireTokenSilent(request) {
					sessionStorage.setItem('test-photo-scopes', JSON.stringify(request.scopes));
					return { accessToken: 'browser-photo-fixture' };
				}
			}
		`,
		}),
	)
}

test('Microsoft photo becomes the Debug entry and its object URL is released on sign-out', async ({
	page,
}) => {
	await signedIn(page)
	await page.addInitScript(() => {
		const revoke = URL.revokeObjectURL.bind(URL)
		URL.revokeObjectURL = (url) => {
			sessionStorage.setItem('test-avatar-revoked', url)
			revoke(url)
		}
	})
	let photos = 0
	await page.route(PHOTO, (route) => {
		if (route.request().method() === 'OPTIONS')
			return route.fulfill({
				status: 204,
				headers: {
					'access-control-allow-origin': '*',
					'access-control-allow-headers': 'authorization',
				},
			})
		photos++
		expect(route.request().headers().authorization).toBe('Bearer browser-photo-fixture')
		return route.fulfill({
			contentType: 'image/png',
			body: PNG,
			headers: { 'access-control-allow-origin': '*' },
		})
	})
	await page.goto('/')
	const trigger = page.getByRole('button', { name: 'Debug', exact: true })
	const photo = trigger.locator('img')
	await expect(photo).toBeVisible()
	await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1)
	const blobUrl = await photo.getAttribute('src')
	expect(blobUrl).toMatch(/^blob:/)
	expect(photos).toBe(1)
	expect(
		await page.evaluate(() => JSON.parse(sessionStorage.getItem('test-photo-scopes') ?? '[]')),
	).toEqual(['User.Read'])
	await trigger.click()
	await expect(page.getByRole('dialog', { name: 'Debug', exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Sign out', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Sign in to Mico' })).toBeVisible()
	expect(await page.evaluate(() => sessionStorage.getItem('test-avatar-revoked'))).toBe(blobUrl)
})

test('a retired Strict Mode bootstrap cannot replace the active avatar session', async ({
	page,
}) => {
	await signedIn(page)
	await page.addInitScript(() => {
		const original = window.fetch.bind(window)
		let releaseRuntime: () => void = () => {}
		const photoStarted = new Promise<void>((resolve) => {
			releaseRuntime = resolve
		})
		let runtimeCalls = 0
		window.fetch = async (input, options) => {
			const url = new URL(
				input instanceof Request ? input.url : String(input),
				window.location.href,
			)
			if (url.pathname === '/api/runtime') {
				const first = ++runtimeCalls === 1
				sessionStorage.setItem('test-runtime-attempts', String(runtimeCalls))
				try {
					// Model a response already buffered before cleanup can cancel its transport.
					const response = await original(
						input,
						first ? { ...options, signal: undefined } : options,
					)
					if (first) await photoStarted
					return response
				} finally {
					if (first) sessionStorage.setItem('test-retired-runtime-settled', 'true')
				}
			}
			const response = await original(input, options)
			if (url.hostname === 'graph.microsoft.com') releaseRuntime()
			return response
		}
	})
	let photos = 0
	let sessions = 0
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/api/auth/session') sessions++
	})
	await page.route(PHOTO, (route) => {
		if (route.request().method() === 'OPTIONS')
			return route.fulfill({
				status: 204,
				headers: {
					'access-control-allow-origin': '*',
					'access-control-allow-headers': 'authorization',
				},
			})
		photos++
		return route.fulfill({
			contentType: 'image/png',
			body: PNG,
			headers: { 'access-control-allow-origin': '*' },
		})
	})
	await page.goto('/')
	const photo = page.getByRole('button', { name: 'Debug', exact: true }).locator('img')
	await expect(photo).toBeVisible()
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem('test-retired-runtime-settled')))
		.toBe('true')
	await page.waitForLoadState('networkidle')
	expect(await page.evaluate(() => sessionStorage.getItem('test-runtime-attempts'))).toBe('2')
	expect(sessions).toBe(1)
	expect(photos).toBe(1)
})

for (const status of [403, 404]) {
	test(`missing or unavailable Graph photo (${status}) keeps the identity entry usable`, async ({
		page,
	}) => {
		await signedIn(page)
		const photoResponse = page.waitForResponse(PHOTO)
		await page.route(PHOTO, (route) =>
			route.fulfill({ status, headers: { 'access-control-allow-origin': '*' } }),
		)
		await page.goto('/')
		expect((await photoResponse).status()).toBe(status)
		const trigger = page.getByRole('button', { name: 'Debug', exact: true })
		await expect(trigger).toBeVisible()
		await expect(trigger).toHaveText('A')
		await expect(trigger.locator('img')).toHaveCount(0)
		await trigger.click()
		await expect(page.getByRole('dialog', { name: 'Debug', exact: true })).toBeVisible()
		await expect(page.getByText('Ada Canvas', { exact: true })).toBeVisible()
		await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
	})
}

test('an undecodable photo returns to the styled avatar fallback', async ({ page }) => {
	await signedIn(page)
	await page.addInitScript(() => {
		document.addEventListener(
			'error',
			(event) => {
				if (event.target instanceof HTMLImageElement && event.target.src.startsWith('blob:')) {
					sessionStorage.setItem('test-avatar-decode-failed', 'true')
				}
			},
			true,
		)
	})
	await page.route(PHOTO, (route) =>
		route.fulfill({
			contentType: 'image/png',
			body: 'invalid image',
			headers: { 'access-control-allow-origin': '*' },
		}),
	)
	await page.goto('/')
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem('test-avatar-decode-failed')))
		.toBe('true')
	const trigger = page.getByRole('button', { name: 'Debug', exact: true })
	await expect(trigger).toHaveText('A')
	await expect(trigger.locator('img')).toHaveCount(0)
	await trigger.click()
	await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
})

test('unauthenticated local mode does not request Microsoft profile data', async ({ page }) => {
	let graphRequests = 0
	page.on('request', (request) => {
		if (new URL(request.url()).hostname === 'graph.microsoft.com') graphRequests++
	})
	await page.goto('/')
	await expect(page.locator('.app')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Debug', exact: true })).toHaveCount(0)
	expect(graphRequests).toBe(0)
})
