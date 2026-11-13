import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { clickWorld, ISOLATED_ORIGIN, resetBoard } from './support'

const shape = {
	id: 'selection-dialog-shape',
	type: 'text' as const,
	x: 320,
	y: 240,
	w: 240,
	h: 100,
	color: '#263248',
	text: 'Selection dialog fixture',
	font: 'sans' as const,
	fontSize: 32 as const,
	fontWeight: 500 as const,
}

async function setAssistantOpen(page: Page, open: boolean) {
	const toggle = page.locator('[data-ai-toggle="true"]')
	const label = open ? 'Close AI assistant' : 'Open AI assistant'
	if ((await toggle.getAttribute('aria-label')) !== label) await toggle.click()
	await expect(toggle).toHaveAttribute('aria-label', label)
	if (open) await expect(page.locator('#ai-panel')).toBeVisible()
	else await expect(page.locator('#ai-panel')).toBeHidden()
}

async function selectFixture(page: Page) {
	await clickWorld(page, shape.x + shape.w / 2, shape.y + shape.h / 2)
	const panel = page.getByRole('region', { name: 'Selected object properties' })
	await expect(panel).toBeVisible()
	return panel
}

test.beforeEach(async ({ page, request, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await resetBoard(request, [shape])
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
})

test('selection dialog follows AI and viewport edges without clipping', async ({
	page,
}, testInfo) => {
	const panel = await selectFixture(page)
	const aiPanel = page.locator('#ai-panel')
	const aiTrigger = page.locator('.ai-trigger')
	const identity = page.locator('.identity-panel')

	await setAssistantOpen(page, false)
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.screenshot({
		path: testInfo.outputPath('selection-desktop-ai-closed.png'),
		animations: 'disabled',
	})
	const closedPanel = await panel.boundingBox()
	const closedTrigger = await aiTrigger.boundingBox()
	if (!closedPanel || !closedTrigger) throw new Error('Missing closed desktop dialog geometry')
	expect(closedTrigger.x - (closedPanel.x + closedPanel.width)).toBe(14)

	await setAssistantOpen(page, true)
	await page.screenshot({
		path: testInfo.outputPath('selection-desktop-ai-open.png'),
		animations: 'disabled',
	})
	const openPanel = await panel.boundingBox()
	const openAi = await aiPanel.boundingBox()
	if (!openPanel || !openAi) throw new Error('Missing open desktop dialog geometry')
	expect(openAi.x - (openPanel.x + openPanel.width)).toBe(14)

	for (const width of [920, 769]) {
		await page.setViewportSize({ width, height: 844 })
		const narrowPanel = await panel.boundingBox()
		const narrowAi = await aiPanel.boundingBox()
		const narrowIdentity = await identity.boundingBox()
		if (!narrowPanel || !narrowAi || !narrowIdentity)
			throw new Error(`Missing open dialog geometry at ${width}px`)
		expect(narrowAi.x - (narrowPanel.x + narrowPanel.width)).toBe(14)
		expect(narrowPanel.x).toBeGreaterThanOrEqual(0)
		expect(narrowPanel.y).toBeGreaterThanOrEqual(narrowIdentity.y + narrowIdentity.height)
	}

	await page.screenshot({
		path: testInfo.outputPath('selection-769-ai-open.png'),
		animations: 'disabled',
	})
	await setAssistantOpen(page, false)
	await page.setViewportSize({ width: 390, height: 844 })
	await expect(panel).toBeVisible()
	const mobilePanel = await panel.boundingBox()
	const dock = await page.getByRole('toolbar').boundingBox()
	if (!mobilePanel || !dock) throw new Error('Missing mobile dialog geometry')
	expect(mobilePanel.x).toBe(16)
	expect(mobilePanel.x + mobilePanel.width).toBe(374)
	expect(mobilePanel.y + mobilePanel.height).toBeLessThan(dock.y)
	await page.screenshot({
		path: testInfo.outputPath('selection-mobile-ai-closed.png'),
		animations: 'disabled',
	})

	await setAssistantOpen(page, true)
	await expect(panel).toBeHidden()
	await page.screenshot({
		path: testInfo.outputPath('selection-mobile-ai-open.png'),
		animations: 'disabled',
	})
	await setAssistantOpen(page, false)
	await expect(panel).toBeVisible()

	await page.setViewportSize({ width: 390, height: 600 })
	const body = panel.locator('.selection-panel-body')
	await expect
		.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight))
		.toBe(true)
	const bodyBox = await body.boundingBox()
	if (!bodyBox) throw new Error('Missing selection dialog scroll area')
	await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2)
	await page.mouse.wheel(0, 500)
	await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
	await page.screenshot({
		path: testInfo.outputPath('selection-mobile-scrolled.png'),
		animations: 'disabled',
	})

	await panel.getByRole('button', { name: 'Close properties', exact: true }).click()
	await expect(panel).toHaveCount(0)
})

test('rounded dialog controls are not clipped by the panel shell', async ({ page }, testInfo) => {
	const panel = await selectFixture(page)
	await setAssistantOpen(page, false)
	const close = panel.getByRole('button', { name: 'Close properties', exact: true })
	await page.keyboard.press('Tab')
	await close.focus()
	await expect(close).toBeFocused()
	await page.screenshot({
		path: testInfo.outputPath('selection-close-focus.png'),
		animations: 'disabled',
	})
	await expect(close).toHaveCSS('outline-style', 'solid')
	const closeBox = await close.boundingBox()
	if (!closeBox) throw new Error('Missing close button')
	const closeImage = await page.screenshot({
		clip: {
			x: Math.floor(closeBox.x) - 4,
			y: Math.floor(closeBox.y) - 4,
			width: Math.ceil(closeBox.width) + 8,
			height: Math.ceil(closeBox.height) + 8,
		},
		animations: 'disabled',
	})
	const corners = await page.evaluate(async (data) => {
		const image = await createImageBitmap(
			await (await fetch(`data:image/png;base64,${data}`)).blob(),
		)
		const canvas = document.createElement('canvas')
		canvas.width = image.width
		canvas.height = image.height
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) throw new Error('Missing canvas context')
		context.drawImage(image, 0, 0)
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
		const count = (left: number) => {
			let result = 0
			for (let y = 0; y < 12; y++) {
				for (let x = left; x < left + 12; x++) {
					const index = (y * canvas.width + x) * 4
					if (pixels[index] < 100 && pixels[index + 1] > 90 && pixels[index + 2] > 130) result++
				}
			}
			return result
		}
		return { left: count(0), right: count(canvas.width - 12) }
	}, closeImage.toString('base64'))
	expect(corners.left).toBeGreaterThan(0)
	expect(corners.right).toBeGreaterThanOrEqual(corners.left * 0.6)

	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	const canvases = page.getByRole('region', { name: 'Canvases', exact: true })
	await expect(canvases).toBeVisible()
	const create = canvases.getByRole('button', { name: 'New canvas', exact: true })
	await page.keyboard.press('Tab')
	await create.focus()
	await expect(create).toBeFocused()
	await page.screenshot({
		path: testInfo.outputPath('canvas-dialog-focus.png'),
		animations: 'disabled',
	})
	await expect(create).toHaveCSS('outline-style', 'solid')

	await expect(panel).toHaveCSS('overflow', 'visible')
	await expect(panel).toHaveCSS('contain', 'none')
	await expect(panel.locator('.selection-panel-body')).toHaveCSS('overflow-y', 'auto')
	await expect(canvases).toHaveCSS('overflow', 'visible')
	await expect(canvases.locator('.canvas-list')).toHaveCSS('overflow-y', 'auto')
	for (const surface of [panel, canvases]) {
		const cornerHitsPanel = await surface.evaluate((element) => {
			const rect = element.getBoundingClientRect()
			const target = document.elementFromPoint(rect.left + 3, rect.top + 3)
			return target instanceof Node && element.contains(target)
		})
		expect(cornerHitsPanel).toBe(false)
	}
})
