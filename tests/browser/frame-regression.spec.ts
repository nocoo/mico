import { expect, test } from '@playwright/test'
import {
	ISOLATED_ORIGIN,
	installMicrophoneMock,
	mockMaiTranscription,
	openAssistant,
	resetBoard,
} from './support'

async function expectLive(page: Parameters<typeof openAssistant>[0]) {
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
}

test.beforeEach(async ({ baseURL, page, request }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.setViewportSize({ width: 1440, height: 960 })
	await resetBoard(request, [])
})

test('Fit keeps a wide board clear of the default-open assistant', async ({ page, request }) => {
	await resetBoard(request, [
		{
			id: 'fit-left',
			type: 'rectangle',
			x: -1800,
			y: 320,
			w: 180,
			h: 120,
			color: '#3b82f6',
			text: 'West',
		},
		{
			id: 'fit-right',
			type: 'rectangle',
			x: 2200,
			y: 520,
			w: 240,
			h: 160,
			color: '#22c55e',
			text: 'East',
		},
	])

	await page.goto('/')
	await expectLive(page)
	const panel = page.getByRole('region', { name: 'AI assistant' })
	await expect(panel).toBeVisible()
	await expect(page.locator('#ai-panel')).toHaveAttribute('aria-hidden', 'false')
	await page.getByRole('button', { name: 'Fit board', exact: true }).click()

	const panelBox = await panel.boundingBox()
	if (!panelBox) throw new Error('Expected the assistant panel')
	for (const id of ['fit-left', 'fit-right']) {
		const node = page.locator(`[data-shape-id="${id}"]`).first()
		await expect(node).toBeVisible()
		const box = await node.boundingBox()
		if (!box) throw new Error(`Missing fitted node ${id}`)
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x)
	}
})

test('initial Escape cancels the keyboard tool without closing the assistant', async ({ page }) => {
	await page.goto('/')
	await expectLive(page)
	const panel = page.locator('#ai-panel')
	await expect(panel).toHaveAttribute('aria-hidden', 'false')

	await page.keyboard.press('r')
	await expect(page.getByRole('button', { name: 'Rectangle', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await page.keyboard.press('Escape')

	await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await expect(panel).toHaveAttribute('aria-hidden', 'false')
	await expect(panel).toBeVisible()
})

test('Text font menu portals over the frame with an opaque usable surface', async ({ page }) => {
	await page.goto('/')
	await expectLive(page)
	await page.getByRole('button', { name: 'Text', exact: true }).click()
	const family = page.getByRole('toolbar', { name: 'Canvas tools' }).getByRole('combobox', {
		name: 'Font family',
		exact: true,
	})
	await family.click()

	const content = page.locator('.select-content')
	const hand = page.getByRole('option', { name: 'Hand', exact: true })
	await expect(content).toBeVisible()
	await expect(hand).toBeVisible()
	const presentation = await content.evaluate((element) => ({
		background: getComputedStyle(element).backgroundColor,
		portaled: !element.closest('.app'),
	}))
	expect(presentation.portaled).toBe(true)
	expect(presentation.background).not.toBe('rgba(0, 0, 0, 0)')
	expect(presentation.background).not.toBe('transparent')
	await hand.hover()
	await expect(hand).toHaveAttribute('data-highlighted', '')
	await hand.click()
	await expect(family).toContainText('Hand')
})

test('MAI long live captions receive pointer input and scroll', async ({ context, page }) => {
	const transcript = Array.from(
		{ length: 36 },
		(_, index) => `Live caption line ${index + 1} remains readable while the lecture continues.`,
	).join(' ')
	await installMicrophoneMock(context)
	await mockMaiTranscription(page, transcript)
	await page.goto('/')
	await expectLive(page)

	const panel = await openAssistant(page, 'Live')
	await panel.getByRole('radio', { name: 'MAI Transcribe' }).click()
	await panel.getByRole('button', { name: 'Start recording' }).click()
	const caption = panel.locator('.call-caption')
	const transcriptText = caption.locator('p')
	await expect(caption).toContainText(transcript)
	await expect(caption).toHaveCSS('pointer-events', 'auto')
	await expect
		.poll(() => transcriptText.evaluate((element) => element.scrollHeight > element.clientHeight))
		.toBe(true)
	const dimensions = await transcriptText.evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
	}))
	expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight)

	const hitCaption = await transcriptText.evaluate((element) => {
		const box = element.getBoundingClientRect()
		return document
			.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
			?.closest('.call-caption')?.className
	})
	expect(hitCaption).toContain('call-caption')
	await transcriptText.hover()
	await page.mouse.wheel(0, 400)
	await expect
		.poll(() => transcriptText.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0)
})

test('MOSS session errors surface in the assistant status pill', async ({ context, page }) => {
	await installMicrophoneMock(context)
	await page.route('**/api/moss/session', (route) =>
		route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({
				error: 'MOSS_SESSION_FAILED',
				message: 'MOSS regression status mock unavailable',
			}),
		}),
	)
	await page.goto('/')
	await expectLive(page)
	const panel = await openAssistant(page, 'Live')
	await panel.getByRole('button', { name: 'Start recording' }).click()

	const status = page.locator('.ai-status-pill')
	await expect(status).toHaveAttribute('data-state', 'attention')
	await expect(status).toContainText('MOSS regression status mock unavailable')
})
