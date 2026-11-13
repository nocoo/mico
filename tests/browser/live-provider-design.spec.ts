import { expect, test } from '@playwright/test'
import { ISOLATED_ORIGIN, openAssistant, resetBoard } from './support'

for (const viewport of [
	{ width: 1440, height: 960 },
	{ width: 390, height: 844 },
]) {
	test(`Live provider selection has one surface at ${viewport.width}px`, async ({
		page,
		request,
		baseURL,
	}, testInfo) => {
		if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
		await resetBoard(request, [])
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.setViewportSize(viewport)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		const panel = await openAssistant(page, 'Live')
		const group = panel.getByRole('radiogroup', { name: 'Live provider' })
		const moss = group.getByRole('radio', { name: 'MOSS Live' })
		const mai = group.getByRole('radio', { name: 'MAI Transcribe' })
		const indicator = group.locator('.rt-SegmentedControlIndicator')
		await expect(moss).toHaveAttribute('data-state', 'on')
		await group.screenshot({ path: testInfo.outputPath('live-provider.png') })
		await expect(indicator).toHaveCSS('display', 'none')
		await expect(moss).not.toHaveCSS('box-shadow', 'none')
		await expect(mai).toHaveCSS('box-shadow', 'none')
		const groupBox = await group.boundingBox()
		if (!groupBox) throw new Error('Missing Live provider control')
		expect(groupBox.x).toBeGreaterThanOrEqual(0)
		expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(viewport.width)
		for (const item of [moss, mai]) {
			const box = await item.boundingBox()
			if (!box) throw new Error('Missing Live provider item')
			expect(box.x).toBeGreaterThanOrEqual(groupBox.x)
			expect(box.x + box.width).toBeLessThanOrEqual(groupBox.x + groupBox.width + 0.1)
			await expect
				.poll(() => item.evaluate((element) => element.scrollWidth - element.clientWidth))
				.toBeLessThanOrEqual(0)
		}
		await mai.click()
		await expect(mai).toHaveAttribute('data-state', 'on')
		await expect(moss).toHaveAttribute('data-state', 'off')
		await expect(mai).not.toHaveCSS('box-shadow', 'none')
		await expect(moss).toHaveCSS('box-shadow', 'none')
		await expect(indicator).toHaveCSS('display', 'none')
		await group.screenshot({ path: testInfo.outputPath('live-provider-mai.png') })
		await mai.focus()
		await page.keyboard.press('ArrowLeft')
		await expect(moss).toBeFocused()
		await expect(moss).toHaveCSS('outline-style', 'solid')
		await page.keyboard.press('Space')
		await expect(moss).toHaveAttribute('data-state', 'on')
	})
}

test('Live provider keeps selected and keyboard focus states in forced colors', async ({
	page,
	request,
	baseURL,
}, testInfo) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await page.emulateMedia({ forcedColors: 'active' })
	await page.goto('/')
	const panel = await openAssistant(page, 'Live')
	const group = panel.getByRole('radiogroup', { name: 'Live provider' })
	const selected = group.getByRole('radio', { name: 'MOSS Live' })
	await expect(selected).toHaveAttribute('aria-checked', 'true')
	await expect(selected).toHaveCSS('border-style', 'solid')
	await expect(selected).toHaveCSS('border-width', '2px')
	await group.screenshot({ path: testInfo.outputPath('live-provider-forced-colors.png') })
	await selected.focus()
	await page.keyboard.press('Tab')
	await page.keyboard.press('Shift+Tab')
	await expect(selected).toBeFocused()
	await expect(selected).toHaveCSS('outline-style', 'solid')
	const other = group.getByRole('radio', { name: 'MAI Transcribe' })
	await page.keyboard.press('ArrowRight')
	await expect(other).toBeFocused()
	await expect(selected).toHaveCSS('border-width', '2px')
	await expect(other).toHaveCSS('outline-style', 'solid')
	await other.click()
	await expect(other).toHaveAttribute('aria-checked', 'true')
	await expect(other).toHaveCSS('border-width', '2px')
	await expect(selected).toHaveCSS('border-width', '0px')
})
