import { expect, test } from '@playwright/test'
import packageJson from '../../package.json' with { type: 'json' }
import { board, ISOLATED_ORIGIN, resetBoard } from './support'

function runtime(
	options: { auth?: 'none' | 'entra'; ephemeral?: boolean; aiEnabled?: boolean } = {},
) {
	const auth = options.auth ?? 'none'
	return {
		auth:
			auth === 'entra'
				? {
						mode: auth,
						clientId: 'browser-test-client',
						tenantId: 'browser-test-tenant',
						authority: 'https://login.microsoftonline.com/browser-test-tenant',
						redirectUri: 'http://127.0.0.1:27063/auth/callback',
					}
				: { mode: auth },
		aiEnabled: options.aiEnabled ?? false,
		ephemeral: options.ephemeral ?? true,
	}
}

async function mockRuntime(
	page: import('@playwright/test').Page,
	value: ReturnType<typeof runtime>,
) {
	await page.route('**/api/runtime', (route) =>
		route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) }),
	)
	await page.route('**/api/auth/session', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' }),
	)
}

async function openWorkspace(page: import('@playwright/test').Page) {
	await mockRuntime(page, runtime())
	await page.goto('/')
	await expect(page.locator('.app')).toBeVisible()
}

async function mockAvatarSession(page: import('@playwright/test').Page) {
	await page.route('**/api/runtime', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify(runtime({ auth: 'entra', ephemeral: false, aiEnabled: true })),
		}),
	)
	await page.route('**/api/auth/session', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ user: { name: 'Ada', expiresAt: Date.now() + 3_600_000 } }),
		}),
	)
	await page.route(/\/@azure_msal-browser\.js(?:\?|$)/, (route) =>
		route.fulfill({
			contentType: 'application/javascript',
			body: `
				const account = { homeAccountId: 'browser-account' };
				const result = { accessToken: 'mock-token', account };
				export class PublicClientApplication {
					async initialize() {}
					async handleRedirectPromise() { return result; }
					async loginRedirect() {}
					async clearCache() {}
					setActiveAccount() {}
					getAllAccounts() { return [account]; }
					getActiveAccount() { return account; }
					async acquireTokenSilent() { return result; }
				}
			`,
		}),
	)
	await page.route('https://graph.microsoft.com/v1.0/me/photos/96x96/$value', (route) => {
		const headers = {
			'access-control-allow-origin': ISOLATED_ORIGIN,
			'access-control-allow-headers': 'authorization',
			'access-control-allow-methods': 'GET, OPTIONS',
			'access-control-expose-headers': 'content-length',
		}
		return route.request().method() === 'OPTIONS'
			? route.fulfill({ status: 204, headers })
			: route.fulfill({ contentType: 'image/png', headers, body: 'not a valid image' })
	})
}

test('debug entry is adjacent, focused, exclusive with Canvases, and dismisses on outside input', async ({
	page,
	request,
	baseURL,
}, testInfo) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await openWorkspace(page)

	const identity = page.locator('.identity-panel')
	const canvases = page.getByRole('button', { name: 'Canvases', exact: true })
	const debug = page.getByRole('button', { name: 'Debug', exact: true })
	await expect(debug).toHaveAttribute('aria-controls', 'debug-panel')
	await expect(debug).toHaveAttribute('title', 'Debug')
	await expect(identity).toHaveCSS('width', '192px')
	await expect(debug).toHaveCSS('width', '34px')
	await expect(debug).toHaveText('')
	await expect(debug.locator('.debug-avatar svg')).toBeVisible()
	const canvasBox = await canvases.boundingBox()
	const debugBox = await debug.boundingBox()
	if (!canvasBox || !debugBox) throw new Error('Expected the identity controls to be measurable')
	expect(debugBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width)
	expect(debugBox.x).toBeLessThan(canvasBox.x + canvasBox.width + 12)
	expect(
		await page.evaluate(
			({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-debug-toggle]')),
			{ x: debugBox.x + debugBox.width / 2, y: debugBox.y + debugBox.height / 2 },
		),
	).toBe(true)

	await debug.click()
	const panel = page.getByRole('dialog', { name: 'Debug' })
	await expect(panel).toBeVisible()
	await expect(debug).toHaveAttribute('aria-expanded', 'true')
	await expect(page.getByRole('button', { name: 'Close Debug' })).toBeFocused()
	await expect(panel.getByText('Preview', { exact: true })).toBeVisible()
	await expect(panel.getByText('Data may disappear', { exact: true })).toBeVisible()
	await expect(panel.getByText('AI unavailable', { exact: true })).toBeVisible()
	await expect(panel.getByText('Manual drawing is available', { exact: true })).toBeVisible()
	await expect(panel.getByText(`Version ${packageJson.version}`, { exact: true })).toBeVisible()
	await page.screenshot({ path: testInfo.outputPath('debug-desktop.png'), fullPage: true })
	await page.keyboard.press('Escape')
	await expect(panel).toHaveCount(0)
	await expect(debug).toBeFocused()

	await debug.click()
	await expect(panel).toBeVisible()
	await canvases.click()
	await expect(panel).toHaveCount(0)
	const canvasPanel = page.getByRole('region', { name: 'Canvases' })
	await expect(canvasPanel).toBeVisible()
	await debug.click()
	await expect(panel).toBeVisible()
	await expect(canvasPanel).toHaveCount(0)

	await page.mouse.click(900, 700)
	await expect(panel).toHaveCount(0)
})

test('Debug reports configured AI without claiming provider connectivity', async ({ page }) => {
	await mockRuntime(page, runtime({ ephemeral: true, aiEnabled: true }))
	await page.goto('/')
	await expect(page.locator('.app')).toBeVisible()
	await page.getByRole('button', { name: 'Debug', exact: true }).click()
	const panel = page.getByRole('dialog', { name: 'Debug' })
	await expect(panel.getByText('AI enabled', { exact: true })).toBeVisible()
	await expect(panel.getByText('AI unavailable', { exact: true })).toHaveCount(0)
	await expect(panel.getByText('Manual drawing is available', { exact: true })).toHaveCount(0)
})

test('default local identity geometry stays unchanged without a Debug entry', async ({ page }) => {
	await mockRuntime(page, runtime({ ephemeral: false, aiEnabled: true }))
	await page.goto('/')
	await expect(page.locator('.app')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Debug', exact: true })).toHaveCount(0)
	await expect(page.locator('.identity-panel')).toHaveCSS('width', '148px')
})

test('debug panel fits a narrow viewport and visually shares the canvas glass tokens', async ({
	page,
}, testInfo) => {
	await openWorkspace(page)
	await page.setViewportSize({ width: 320, height: 640 })
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })

	const debug = page.getByRole('button', { name: 'Debug', exact: true })
	await expect(page.locator('.identity-panel')).toHaveCSS('width', '160px')
	await debug.click()
	const panel = page.getByRole('dialog', { name: 'Debug' })
	await expect(panel).toBeVisible()
	await page.locator('.radix-themes').evaluateAll((themes) => {
		for (const theme of themes) (theme as HTMLElement).style.colorScheme = 'dark'
	})
	const debugBox = await panel.boundingBox()
	if (!debugBox) throw new Error('Expected the Debug panel to be measurable')
	expect(debugBox.x).toBeGreaterThanOrEqual(14)
	expect(debugBox.x + debugBox.width).toBeLessThanOrEqual(306)
	expect(debugBox.y).toBeGreaterThanOrEqual(14)
	expect(debugBox.y + debugBox.height).toBeLessThanOrEqual(626)
	await expect(panel).toHaveCSS('animation-duration', '1ms')
	await panel.screenshot({ path: testInfo.outputPath('debug-panel.png') })
	await page.screenshot({ path: testInfo.outputPath('debug-mobile.png'), fullPage: true })
	const debugStyles = await panel.evaluate((node) => {
		const style = getComputedStyle(node)
		const gloss = getComputedStyle(node, '::before')
		return {
			background: style.backgroundImage,
			backdrop: style.backdropFilter,
			shadow: style.boxShadow,
			radius: style.borderRadius,
			gloss: gloss.backgroundImage,
			glassToken: style.getPropertyValue('--ui-glass').trim(),
			colorScheme: style.colorScheme,
		}
	})

	const toggle = page.getByRole('button', { name: 'Canvases', exact: true })
	await toggle.click()
	const canvasPanel = page.getByRole('region', { name: 'Canvases' })
	await expect(canvasPanel).toBeVisible()
	await canvasPanel.screenshot({ path: testInfo.outputPath('canvas-panel.png') })
	const canvasStyles = await canvasPanel.evaluate((node) => {
		const style = getComputedStyle(node)
		const gloss = getComputedStyle(node, '::before')
		return {
			background: style.backgroundImage,
			backdrop: style.backdropFilter,
			shadow: style.boxShadow,
			radius: style.borderRadius,
			gloss: gloss.backgroundImage,
			glassToken: style.getPropertyValue('--ui-glass').trim(),
			colorScheme: style.colorScheme,
		}
	})
	expect(debugStyles).toEqual(canvasStyles)
	expect(debugStyles.glassToken).toContain('light-dark(')
	await expect(canvasPanel).toHaveCSS('color-scheme', 'dark')
})

test('provided avatar image failures fall back to the signed-in user initial', async ({ page }) => {
	await mockAvatarSession(page)
	await page.goto('/')
	await expect(page.locator('.app')).toBeVisible()
	const trigger = page.getByRole('button', { name: 'Debug', exact: true })
	await expect(trigger.locator('.debug-avatar')).toHaveText('A')
	await trigger.click()
	const panel = page.getByRole('dialog', { name: 'Debug' })
	await expect(panel.locator('.debug-avatar-user')).toHaveText('A')
	await expect(panel.getByText('Ada', { exact: true })).toBeVisible()
	await expect(panel.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('clicking the canvas outside Debug still performs a drawing gesture', async ({
	page,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await openWorkspace(page)
	await page.getByRole('button', { name: 'Debug', exact: true }).click()
	await expect(page.getByRole('dialog', { name: 'Debug' })).toBeVisible()
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await page.locator('.canvas').click({ position: { x: 700, y: 600 } })
	await expect(page.getByRole('dialog', { name: 'Debug' })).toHaveCount(0)
	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'note'))
		.toBe(true)
})
