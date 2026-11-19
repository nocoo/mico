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
		const optionStyle = (item: typeof selected) =>
			item.evaluate((element) => ({
				color: getComputedStyle(element).color,
				weight: getComputedStyle(element).fontWeight,
			}))
		expect(await optionStyle(selected)).toEqual(
			await optionStyle(menu.locator('.select-item[data-state="unchecked"]').first()),
		)
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

for (const viewport of [
	{ width: 1440, height: 960 },
	{ width: 390, height: 844 },
]) {
	for (const input of ['mouse', 'keyboard'] as const) {
		test(`recording menu keeps its width on ${input} selection at ${viewport.width}px`, async ({
			page,
			request,
			baseURL,
		}) => {
			if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
			await resetBoard(request, [])
			await page.emulateMedia({ reducedMotion: 'no-preference' })
			await page.setViewportSize(viewport)
			await page.goto('/')
			await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
			const panel = await openAssistant(page, 'Audio')
			const recording = panel.getByRole('combobox', { name: 'Recording' })
			await recording.click()
			const menu = page.locator('.lesson-recording-menu')
			await expect(menu).toBeVisible()
			const width = await menu.evaluate((element) => (element as HTMLElement).offsetWidth)
			const next = page.getByRole('option').nth(1)
			const label = await next.textContent()
			if (!label) throw new Error('Missing recording label')
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
			if (input === 'mouse') await next.click()
			else {
				await expect(menu.locator('.select-item[data-state="checked"]')).toBeFocused()
				await page.keyboard.press('ArrowDown')
				await expect(next).toBeFocused()
				await page.keyboard.press('Enter')
			}
			await expect(menu).toHaveCount(0)
			await expect(recording).toContainText(label)
			const samples = await page.evaluate(
				() =>
					(
						window as unknown as {
							__recordingMenuWidths: { state: string | null; width: number }[]
						}
					).__recordingMenuWidths,
			)
			const closing = samples.filter((sample) => sample.state === 'closed')
			expect(closing.length).toBeGreaterThan(0)
			for (const sample of closing) expect(sample.width).toBe(width)
		})
	}
}

test('recording selection remains outlined in forced colors', async ({
	page,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await page.emulateMedia({ forcedColors: 'active' })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	const panel = await openAssistant(page, 'Audio')
	await panel.getByRole('combobox', { name: 'Recording' }).click()
	const selected = page.locator('.lesson-recording-menu .select-item[data-state="checked"]')
	await expect(selected).toHaveCSS('outline-style', 'solid')
	await expect(selected).toHaveCSS('outline-width', '2px')
	await expect(selected.locator('.rt-SelectItemIndicator')).toBeHidden()
})

test('settings dropdowns use single selection state, compact padding, and aligned width', async ({
	page,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await page.route('**/api/ai/models', (route) =>
		route.fulfill({ json: { models: ['auto/gpt-6-sol', 'auto/gpt-6.1-sol'] } }),
	)
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

	const panel = await openAssistant(page, 'Settings')
	const settings = panel.getByRole('tabpanel', { name: 'Settings' })
	const reasoningTrigger = settings.getByRole('combobox', { name: 'Live / Audio reasoning' })
	const triggerBox = await reasoningTrigger.boundingBox()
	if (!triggerBox) throw new Error('Missing reasoning trigger')
	await reasoningTrigger.click()

	const menu = page.locator('.select-content')
	await expect(menu).toBeVisible()
	await menu.evaluate((el) =>
		Promise.all(el.getAnimations().map((animation) => animation.finished)),
	)
	await expect(menu).toHaveCSS('padding', '4px')
	await expect(menu.locator('.rt-SelectViewport')).toHaveCSS('padding', '0px')

	const selected = menu.locator('.select-item[data-state="checked"]')
	await expect(selected).toHaveCount(1)
	await expect(selected.locator('.rt-SelectItemIndicator')).toBeHidden()
	await expect(selected).toHaveCSS('padding', '5px 8px')
	await expect(selected).toHaveCSS('box-shadow', 'none')
	await expect(selected).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

	const menuBox = await menu.boundingBox()
	if (!menuBox) throw new Error('Missing reasoning menu box')
	expect(Math.abs(menuBox.width - triggerBox.width)).toBeLessThanOrEqual(1)
	await selected.click()
	await expect(menu).toHaveCount(0)

	const modelRoot = settings.locator('#ai-settings-model').locator('..')
	const modelBox = await modelRoot.boundingBox()
	const modelPicker = settings.getByRole('combobox', { name: 'Choose model' })
	await expect(modelPicker).toBeEnabled()
	await modelPicker.click()

	const modelMenu = page.locator('.select-content.ai-model-menu')
	await expect(modelMenu).toBeVisible()
	await modelMenu.evaluate((el) =>
		Promise.all(el.getAnimations().map((animation) => animation.finished)),
	)
	const modelMenuBox = await modelMenu.boundingBox()
	if (!modelBox || !modelMenuBox) throw new Error('Missing model input or menu box')
	expect(Math.abs(modelMenuBox.x - modelBox.x)).toBeLessThanOrEqual(1)
	expect(Math.abs(modelMenuBox.width - modelBox.width)).toBeLessThanOrEqual(1)
	await expect(modelMenu.locator('.select-item').first()).toHaveCSS('padding', '5px 8px')

	const width = await modelMenu.evaluate((element) => (element as HTMLElement).offsetWidth)
	await page.evaluate(() => {
		const samples: { state: string | null; width: number }[] = []
		Object.assign(window, { __modelMenuWidths: samples })
		let remaining = 90
		const sample = () => {
			const element = document.querySelector<HTMLElement>('.ai-model-menu')
			if (element)
				samples.push({ state: element.dataset.state ?? null, width: element.offsetWidth })
			if (--remaining > 0) requestAnimationFrame(sample)
		}
		requestAnimationFrame(sample)
	})
	await page.getByRole('option', { name: 'auto/gpt-6-sol' }).click()
	await expect(modelMenu).toHaveCount(0)
	const samples = await page.evaluate(
		() =>
			(window as unknown as { __modelMenuWidths: { state: string | null; width: number }[] })
				.__modelMenuWidths,
	)
	const closing = samples.filter((sample) => sample.state === 'closed')
	expect(closing.length).toBeGreaterThan(0)
	for (const sample of closing) expect(sample.width).toBe(width)
})
