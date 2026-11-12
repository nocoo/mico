import { expect, test } from '@playwright/test'
import { ISOLATED_ORIGIN, openAssistant, resetBoard } from './support'

for (const viewport of [
	{ width: 1440, height: 960 },
	{ width: 390, height: 844 },
]) {
	test(`recording picker uses bounded glass menu at ${viewport.width}px`, async ({
		page,
		request,
		baseURL,
	}) => {
		if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
		await resetBoard(request, [])
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.setViewportSize(viewport)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		const panel = await openAssistant(page, 'Audio')
		const recording = panel.getByRole('combobox', { name: 'Recording' })
		await recording.click()
		const menu = page.locator('.select-content')
		await expect(menu).toBeVisible()
		await expect(menu).toHaveCSS('backdrop-filter', 'blur(22px) saturate(1.7)')
		const box = await menu.boundingBox()
		if (!box) throw new Error('Missing recording menu')
		expect(box.width).toBeLessThanOrEqual(348)
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
		const scrollable = await menu
			.locator('.rt-SelectViewport')
			.evaluate((element) => element.scrollHeight > element.clientHeight)
		expect(scrollable).toBe(true)
		const finalOption = page.getByRole('option').last()
		const label = await finalOption.textContent()
		if (!label) throw new Error('Missing recording label')
		await finalOption.scrollIntoViewIfNeeded()
		await finalOption.click()
		await expect(recording).toContainText(label)
		await expect(recording).toHaveCSS('outline-style', 'none')
	})
}
