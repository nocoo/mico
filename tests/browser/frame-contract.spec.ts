import { expect, type Locator, type Page, test } from '@playwright/test'
import {
	flexContentWidth,
	ISOLATED_ORIGIN,
	installMicrophoneMock,
	mockMaiTranscription,
	resetBoard,
} from './support'

interface Box {
	x: number
	y: number
	width: number
	height: number
}

async function getBox(locator: Locator): Promise<Box> {
	const box = await locator.boundingBox()
	if (!box) throw new Error('Element has no bounding box')
	return box
}

function expectBox(actual: Box, expected: Box) {
	for (const key of ['x', 'y', 'width', 'height'] as const) {
		expect(
			Math.abs(actual[key] - expected[key]),
			`${key}: ${actual[key]} vs ${expected[key]}`,
		).toBeLessThanOrEqual(1)
	}
}

async function openApp(page: Page) {
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
}

test.beforeEach(async ({ request, baseURL, page }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await resetBoard(request, [])
})

test('desktop frame follows reference geometry while preserving Mico identity', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 960 })
	await openApp(page)
	await expect(page.locator('.frame-empty')).toBeVisible()

	const identity = await getBox(page.locator('.identity-panel'))
	expect(identity.x).toBe(14)
	expect(identity.y).toBe(14)
	expect(identity.height).toBe(56)
	expect(identity.width).toBeCloseTo(await flexContentWidth(page.locator('.identity-panel')), 1)
	expectBox(await getBox(page.locator('.brand-mark')), { x: 24, y: 24, width: 36, height: 36 })
	await expect(page.locator('.brand-mark-icon')).toHaveAttribute('src', '/logo.png')
	await expect(page.locator('.brand strong')).toHaveText('mico')
	await expect(page.locator('.meeting-frame')).toHaveCount(0)
	const liveTopbar = page.locator('.live-topbar-frame')
	await expect(liveTopbar).toBeVisible()
	const liveBox = await getBox(liveTopbar)
	expect(liveBox.x).toBeCloseTo(identity.x + identity.width + 10, 1)
	expect(liveBox.y).toBe(14)
	expect(liveBox.height).toBe(56)
	await expect(liveTopbar).toContainText('Local session')

	const panel = page.getByRole('region', { name: 'AI assistant' })
	expectBox(await getBox(panel), { x: 1054, y: 14, width: 372, height: 932 })
	await expect(panel.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true')
	const empty = await getBox(page.locator('.frame-empty'))
	expectBox(empty, { x: 260, y: 283, width: 520, height: 316 })
	const toolbar = await getBox(page.locator('.toolbar-module'))
	expect(toolbar.y).toBe(890)
	expect(toolbar.height).toBe(56)
	expect(Math.abs(toolbar.x + toolbar.width / 2 - 619)).toBeLessThanOrEqual(1)
	const status = await getBox(page.locator('.ai-status-pill'))
	expect(status.y).toBe(840)
	expect(status.height).toBe(38)
	expect(Math.abs(status.x + status.width / 2 - 520)).toBeLessThanOrEqual(1)
	await expect(page.locator('.identity-panel')).toHaveCSS(
		'backdrop-filter',
		'blur(22px) saturate(1.7)',
	)
	await expect(page.locator('.toolbar-module')).toHaveCSS('border-radius', '24px')
	await expect(panel).toHaveCSS('border-radius', '30px')
})

test('assistant open and close re-centres the toolbar and keeps canvas management available', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 960 })
	await openApp(page)
	await page.getByRole('button', { name: 'Close AI assistant' }).click()
	await expect(page.locator('#ai-panel')).toHaveAttribute('aria-hidden', 'true')
	await expect
		.poll(async () => {
			const box = await getBox(page.locator('.toolbar-module'))
			return Math.round(box.x + box.width / 2)
		})
		.toBe(819)
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await expect(page.locator('[data-canvas-panel="true"]')).toBeVisible()
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await page.getByRole('button', { name: 'Open AI assistant' }).click()
	await expect(page.locator('#ai-panel')).toHaveAttribute('aria-hidden', 'false')
	await expect
		.poll(async () => {
			const box = await getBox(page.locator('.toolbar-module'))
			return Math.round(box.x + box.width / 2)
		})
		.toBe(619)
})

test('Escape closes the assistant after opening it from its trigger', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 960 })
	await openApp(page)
	await page.getByRole('button', { name: 'Close AI assistant' }).click()
	const trigger = page.getByRole('button', { name: 'Open AI assistant' })
	await trigger.focus()
	await page.keyboard.press('Enter')
	await expect(page.locator('#ai-panel')).toHaveAttribute('aria-hidden', 'false')
	await page.keyboard.press('Escape')
	await expect(page.locator('#ai-panel')).toHaveAttribute('aria-hidden', 'true')
	await expect(trigger).toBeFocused()
})

test('selection properties remain accessible beside the open assistant', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		{ id: 'frame-test-rect', type: 'rectangle', x: 0, y: 0, w: 200, h: 120, color: '#00a2e1' },
	])
	await page.setViewportSize({ width: 1440, height: 960 })
	await openApp(page)
	await page.locator('[data-shape-id="frame-test-rect"]').click()
	const properties = page.getByRole('region', { name: 'Selected object properties' })
	await expect(properties).toBeVisible()
	const propertiesBox = await getBox(properties)
	const panelBox = await getBox(page.locator('#ai-panel'))
	expect(propertiesBox.x + propertiesBox.width).toBeLessThanOrEqual(panelBox.x - 14)
})

test('mobile frame opens with a scrollable toolbar even when the assistant is open', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await openApp(page)
	await expect(page.locator('#ai-panel')).toHaveAttribute('aria-hidden', 'true')
	const mobileIdentity = await getBox(page.locator('.identity-panel'))
	expect(mobileIdentity.x).toBe(14)
	expect(mobileIdentity.y).toBe(14)
	expect(mobileIdentity.height).toBe(56)
	expect(mobileIdentity.width).toBeCloseTo(
		await flexContentWidth(page.locator('.identity-panel')),
		1,
	)
	await page.getByRole('button', { name: 'Open AI assistant' }).click()
	await expect(page.locator('#ai-panel')).toHaveAttribute('aria-hidden', 'false')
	const box = await getBox(page.locator('.toolbar-module'))
	expect(box.width).toBeGreaterThan(300)
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(390)
	const scrollable = await page
		.locator('.dock-main')
		.evaluate((element) => element.scrollWidth > element.clientWidth)
	expect(scrollable).toBe(true)
})

test('auto-switches UI copy to Chinese when ?lang=zh is set', async ({ page }) => {
	await page.goto('/?lang=zh')
	await expect(page.getByRole('button', { name: '画布列表', exact: true })).toBeVisible()
	await expect(page.locator('.live-topbar-frame')).toContainText('本地会话')
	const panel = page.getByRole('region', { name: 'AI assistant' })
	await expect(panel.getByRole('tab', { name: '对话' })).toHaveAttribute('aria-selected', 'true')
})

test('topbar bars share 56px height and live mic opens Live tab', async ({ context, page }) => {
	await installMicrophoneMock(context)
	await mockMaiTranscription(page)
	await page.setViewportSize({ width: 1440, height: 960 })
	await openApp(page)
	const identityBox = await getBox(page.locator('.identity-panel'))
	const liveBox = await getBox(page.locator('.live-topbar-frame'))
	expect(identityBox.height).toBe(56)
	expect(liveBox.height).toBe(56)
	await expect(page.locator('.meeting-frame')).toHaveCount(0)

	await page.getByRole('button', { name: 'Close AI assistant' }).click()
	await expect(page.locator('#ai-panel')).toHaveAttribute('aria-hidden', 'true')
	await page.locator('.live-topbar-mic').click()
	await expect(page.locator('#ai-panel')).toHaveAttribute('aria-hidden', 'false')
	await expect(page.locator('#ai-tab-live')).toHaveAttribute('aria-selected', 'true')
})
