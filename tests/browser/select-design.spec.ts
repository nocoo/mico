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
		const openTrigger = page.locator('.lesson .select-trigger')
		await expect(openTrigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
		await expect(openTrigger).toHaveCSS('box-shadow', 'none')
		const menu = page.locator('.select-content')
		await expect(menu).toBeVisible()
		const selected = menu.locator('.select-item[data-state="checked"]')
		await expect(selected).toHaveCount(1)
		await expect(selected.locator('.rt-SelectItemIndicator')).toBeHidden()
		await expect(selected).toHaveCSS('background-image', 'none')
		await expect(selected).not.toHaveCSS('box-shadow', 'none')
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

test('recording menu keeps its width throughout the closing animation', async ({
	page,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await page.emulateMedia({ reducedMotion: 'no-preference' })
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	const panel = await openAssistant(page, 'Audio')
	const recording = panel.getByRole('combobox', { name: 'Recording' })
	await recording.click()
	const menu = page.locator('.lesson-recording-menu')
	await expect(menu).toBeVisible()
	const width = await menu.evaluate((element) => (element as HTMLElement).offsetWidth)
	await page.evaluate(() => {
		const samples: { state: string | null; width: number }[] = []
		Object.assign(window, { __recordingMenuWidths: samples })
		let remaining = 120
		const sample = () => {
			const element = document.querySelector<HTMLElement>('.lesson-recording-menu')
			if (element)
				samples.push({ state: element.dataset.state ?? null, width: element.offsetWidth })
			if (--remaining > 0) requestAnimationFrame(sample)
		}
		requestAnimationFrame(sample)
	})
	await page.getByRole('option').nth(1).click()
	await expect(menu).toHaveCount(0)
	const samples = await page.evaluate(
		() =>
			(window as unknown as { __recordingMenuWidths: { state: string | null; width: number }[] })
				.__recordingMenuWidths,
	)
	const closing = samples.filter((sample) => sample.state === 'closed')
	expect(closing.length).toBeGreaterThan(0)
	for (const sample of closing) expect(sample.width).toBe(width)
})
