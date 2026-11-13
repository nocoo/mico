import { expect, type Locator, test } from '@playwright/test'
import { openAssistant, resetBoard } from './support'

const tabs = ['Chat', 'Audio', 'Live', 'Settings'] as const

async function expectInside(target: Locator, container: Locator) {
	const targetBox = await target.boundingBox()
	const containerBox = await container.boundingBox()
	if (!targetBox || !containerBox) throw new Error('Missing dialog geometry')
	expect(targetBox.x).toBeGreaterThanOrEqual(containerBox.x)
	expect(targetBox.x + targetBox.width).toBeLessThanOrEqual(containerBox.x + containerBox.width + 1)
	expect(targetBox.y).toBeGreaterThanOrEqual(containerBox.y)
	expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(
		containerBox.y + containerBox.height + 1,
	)
}

test.beforeEach(async ({ page, request }) => {
	await resetBoard(request, [])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.route('**/api/ai/settings', async (route) => {
		await route.fulfill({
			json: {
				baseURL: 'https://api.example.test/v1',
				model: 'model/demo',
				hasApiKey: true,
				readOnly: false,
			},
		})
	})
	await page.route('**/api/ai/models', (route) =>
		route.fulfill({ json: { models: ['model/demo', 'model/other'] } }),
	)
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
})

test('the assistant tabs keep content padding and the close control clear of the rounded panel', async ({
	page,
}) => {
	const panel = await openAssistant(page, 'Chat')
	await expect(panel).toHaveCSS('border-radius', '30px')
	await expect(panel).toHaveCSS('overflow', 'hidden')

	for (const name of tabs) {
		const tab = panel.getByRole('tab', { name, exact: true })
		await tab.click()
		await expect(tab).toHaveAttribute('aria-selected', 'true')
		const geometry = await tab.evaluate((element) => {
			const style = getComputedStyle(element)
			const rect = element.getBoundingClientRect()
			const content = [...element.children]
				.filter((child) => getComputedStyle(child).display !== 'none')
				.map((child) => child.getBoundingClientRect())
			return {
				clientWidth: element.clientWidth,
				scrollWidth: element.scrollWidth,
				paddingLeft: Number.parseFloat(style.paddingLeft),
				paddingRight: Number.parseFloat(style.paddingRight),
				leftGap: Math.min(...content.map((child) => child.left)) - rect.left,
				rightGap: rect.right - Math.max(...content.map((child) => child.right)),
			}
		})
		const minimumPadding = name === 'Settings' ? 8 : 6
		expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
		expect(geometry.paddingLeft).toBeGreaterThanOrEqual(minimumPadding)
		expect(geometry.paddingRight).toBeGreaterThanOrEqual(minimumPadding)
		expect(geometry.leftGap).toBeGreaterThanOrEqual(minimumPadding)
		expect(geometry.rightGap).toBeGreaterThanOrEqual(minimumPadding)
	}

	for (const width of [1440, 920, 769]) {
		await page.setViewportSize({ width, height: 960 })
		const list = panel.locator('.ai-tabs')
		await expect
			.poll(() => list.evaluate((element) => element.scrollWidth - element.clientWidth))
			.toBeLessThanOrEqual(0)
		const settings = panel.getByRole('tab', { name: 'Settings', exact: true })
		const hit = await settings.evaluate((element) => {
			const rect = element.getBoundingClientRect()
			return (
				document.elementFromPoint(rect.right - 3, rect.top + rect.height / 2)?.closest('button') ===
				element
			)
		})
		expect(hit).toBe(true)
		await panel.getByRole('tab', { name: 'Audio', exact: true }).click()
		const box = await settings.boundingBox()
		if (!box) throw new Error('Missing Settings tab')
		await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2)
		await page.mouse.down()
		await expect(settings).toHaveCSS('scale', 'none')
		await page.mouse.up()
		await expect(settings).toHaveAttribute('aria-selected', 'true')
		await expect(panel).toBeVisible()
	}
	await page.setViewportSize({ width: 1440, height: 960 })

	await panel.getByRole('tab', { name: 'Chat', exact: true }).focus()
	await page.keyboard.press('End')
	await expect(panel.getByRole('tab', { name: 'Settings', exact: true })).toBeFocused()
	await page.keyboard.press('Home')
	await expect(panel.getByRole('tab', { name: 'Chat', exact: true })).toBeFocused()

	const close = page.getByRole('button', { name: 'Close AI assistant', exact: true })
	await close.hover()
	await expect(close).toHaveCSS('background-color', /^(?!rgba\(0, 0, 0, 0\)$).*/)
	await page.keyboard.press('Tab')
	await close.focus()
	await expect(close).toBeFocused()
	await expect(close).toHaveCSS('outline-style', 'solid')

	const closeBox = await close.boundingBox()
	const panelBox = await panel.boundingBox()
	if (!closeBox || !panelBox) throw new Error('Missing close control geometry')
	const focusExtent = 4
	expect(closeBox.y - focusExtent).toBeGreaterThanOrEqual(panelBox.y)
	expect(closeBox.x + closeBox.width + focusExtent).toBeLessThanOrEqual(panelBox.x + panelBox.width)
})

test('Settings controls remain usable on a narrow assistant panel', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 568 })
	const panel = await openAssistant(page, 'Settings')
	const settings = panel.getByRole('tabpanel', { name: 'Settings' })
	await expect(settings).toBeVisible()
	await expect(panel.locator('.ai-tabs')).toHaveJSProperty(
		'scrollWidth',
		await panel.locator('.ai-tabs').evaluate((element) => element.clientWidth),
	)

	const controls = [
		settings.getByLabel('Endpoint'),
		settings.getByLabel('Model', { exact: true }),
		settings.getByRole('combobox', { name: 'Choose model' }),
		settings.getByLabel('API key', { exact: true }),
		settings.getByRole('checkbox', { name: 'Remove current API key' }),
		settings.getByRole('button', { name: 'Save settings' }),
	]
	for (const control of controls) {
		await control.scrollIntoViewIfNeeded()
		await expectInside(control, panel)
	}

	const endpoint = settings.getByLabel('Endpoint')
	const model = settings.getByLabel('Model', { exact: true })
	const apiKey = settings.getByLabel('API key', { exact: true })
	const clearKey = settings.getByRole('checkbox', { name: 'Remove current API key' })
	await endpoint.fill('https://new.example.test/v1')
	await model.fill('model/custom')
	await apiKey.fill('new-key')
	await clearKey.check()
	await expect(apiKey).toBeDisabled()
	await clearKey.uncheck()
	await expect(apiKey).toBeEnabled()

	await page.unroute('**/api/ai/settings')
	let saved: unknown
	await page.route('**/api/ai/settings', async (route) => {
		if (route.request().method() === 'PUT') saved = route.request().postDataJSON()
		await route.fulfill({
			json: {
				baseURL: 'https://new.example.test/v1',
				model: 'model/custom',
				hasApiKey: true,
				readOnly: false,
			},
		})
	})
	await settings.getByRole('button', { name: 'Save settings' }).click()
	await expect(settings.getByRole('status')).toHaveText('Settings saved.')
	expect(saved).toEqual({
		baseURL: 'https://new.example.test/v1',
		model: 'model/custom',
		apiKey: 'new-key',
	})
})

test('deployment-managed AI settings are read-only without provider requests', async ({ page }) => {
	await page.unroute('**/api/ai/settings')
	await page.unroute('**/api/ai/models')
	let modelRequests = 0
	let putRequests = 0
	await page.route('**/api/ai/settings', async (route) => {
		if (route.request().method() === 'PUT') {
			putRequests++
			await route.fulfill({ status: 403, json: { error: 'AI_SETTINGS_READ_ONLY' } })
			return
		}
		await route.fulfill({
			json: {
				baseURL: 'https://deployment.example.test/v1',
				model: 'deployment/model',
				hasApiKey: true,
				readOnly: true,
			},
		})
	})
	await page.route('**/api/ai/models', async (route) => {
		modelRequests++
		await route.fulfill({ json: { models: ['must-not-load'] } })
	})
	await page.reload()

	const panel = await openAssistant(page, 'Settings')
	const settings = panel.getByRole('tabpanel', { name: 'Settings' })
	await expect(
		settings.getByText('AI settings are managed by this deployment and cannot be changed here.'),
	).toBeVisible()
	await expect(settings.getByLabel('Endpoint')).toBeDisabled()
	await expect(settings.getByLabel('Model', { exact: true })).toBeDisabled()
	await expect(settings.getByRole('combobox', { name: 'Choose model' })).toBeDisabled()
	await expect(settings.getByLabel('API key', { exact: true })).toBeDisabled()
	await expect(settings.getByRole('checkbox', { name: 'Remove current API key' })).toBeDisabled()
	await expect(settings.getByRole('button', { name: 'Save settings' })).toBeDisabled()

	await settings.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
	await page.waitForTimeout(100)
	expect(putRequests).toBe(0)
	expect(modelRequests).toBe(0)
})

test('the mobile status pill yields to the open panel and returns when closed', async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 320, height: 568 })
	const panel = await openAssistant(page, 'Settings')
	const settings = panel.getByRole('tabpanel', { name: 'Settings' })
	const save = settings.getByRole('button', { name: 'Save settings' })
	const status = page.getByRole('status').filter({ hasText: 'Mico is ready' })

	await save.scrollIntoViewIfNeeded()
	await expect(status).toHaveAttribute('aria-live', 'polite')
	await expect(status).toHaveCSS('opacity', '0')
	await expectInside(save, panel)
	const saveTextIsUncovered = await save.evaluate((element) => {
		const rect = element.getBoundingClientRect()
		const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
		return target instanceof Node && element.contains(target)
	})
	expect(saveTextIsUncovered).toBe(true)
	await page.screenshot({ path: testInfo.outputPath('assistant-settings-320.png') })

	await page.getByRole('button', { name: 'Close AI assistant', exact: true }).click()
	await expect(panel).toBeHidden()
	await expect(status).toHaveCSS('opacity', '1')
})

test('rounded panel clipping and scroll bounds survive long Chat, Audio, and Settings content', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 480 })
	const panel = await openAssistant(page, 'Chat')
	const messages = panel.getByRole('log', { name: 'Conversation' })
	await messages.evaluate((element) => {
		for (let index = 0; index < 12; index += 1) {
			const item = document.createElement('p')
			item.textContent = `Long message ${index}: ${'Mico can keep the lesson content inside the rounded panel. '.repeat(4)}`
			element.append(item)
		}
	})

	const cases = [
		{ tab: 'Chat', scroller: messages },
		{ tab: 'Audio', scroller: panel.locator('.lesson') },
		{ tab: 'Settings', scroller: panel.locator('.ai-settings') },
	] as const
	for (const { tab, scroller } of cases) {
		await panel.getByRole('tab', { name: tab, exact: true }).click()
		await scroller.evaluate((element) => {
			element.scrollTop = element.scrollHeight
		})
		await expect
			.poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight))
			.toBe(true)
		await expect(panel).toHaveCSS('overflow', 'hidden')
		await expect(panel).toHaveCSS('pointer-events', 'auto')

		const hitTargetsPanel = await panel.evaluate((element) => {
			const rect = element.getBoundingClientRect()
			return [
				[rect.left + 18, rect.top + 18],
				[rect.left + 18, rect.bottom - 18],
				[rect.right - 18, rect.bottom - 18],
			].every(([x, y]) => {
				const target = document.elementFromPoint(x, y)
				return target instanceof Node && element.contains(target)
			})
		})
		expect(hitTargetsPanel).toBe(true)
	}
})
