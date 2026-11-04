import { expect, test } from '@playwright/test'
import { board, resetBoard } from './support'

const AI_BUTTON = 'AI assistant'

test.beforeEach(async ({ page, request }) => {
	await resetBoard(request, [])
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
})

test('the AI panel sends a message and answers in the chat log', async ({ page }) => {
	const trigger = page.getByRole('button', { name: AI_BUTTON, exact: true })
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
	await trigger.click()
	await expect(trigger).toHaveAttribute('aria-expanded', 'true')

	const panel = page.getByRole('region', { name: AI_BUTTON })
	await expect(panel).toBeVisible()
	await expect(panel.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true')
	await expect(panel.locator('.ai-message.assistant .ai-message-text')).toHaveCount(1)

	const composer = panel.getByRole('textbox', { name: 'Message the assistant' })
	await composer.fill('Sketch a login flow')
	await composer.press('Enter')

	await expect(panel.locator('.ai-message.user .ai-message-text')).toHaveText('Sketch a login flow')
	await expect(panel.locator('.ai-typing')).toBeVisible()
	await expect(panel.locator('.ai-message.assistant .ai-message-text')).toHaveCount(2)
	await expect(panel.locator('.ai-message.assistant .ai-message-text').last()).toContainText(
		'Sketch a login flow',
	)
	await expect(panel.locator('.ai-typing')).toHaveCount(0)
	await expect(composer).toHaveValue('')

	await composer.fill('Group the field and the button into a frame')
	await panel.getByRole('button', { name: 'Send message' }).click()
	await expect(panel.locator('.ai-message.user .ai-message-text')).toHaveCount(2)
	await expect(panel.locator('.ai-message.assistant .ai-message-text')).toHaveCount(3)

	await page.keyboard.press('Escape')
	await expect(panel).toBeHidden()
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
	await expect(trigger).toBeFocused()

	await trigger.click()
	await expect(panel.locator('.ai-message.user .ai-message-text')).toHaveCount(2)
})

test('the audio tab fills the dialog with a recording microphone', async ({ page }) => {
	await page.getByRole('button', { name: AI_BUTTON, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Audio' }).click()
	await expect(panel.getByRole('tab', { name: 'Audio' })).toHaveAttribute('aria-selected', 'true')
	await expect(panel.getByRole('tabpanel', { name: 'Audio' })).toBeVisible()

	const mic = panel.getByRole('button', { name: 'Start recording' })
	await expect(mic).toBeVisible()
	const box = await mic.boundingBox()
	const panelBox = await panel.boundingBox()
	if (!box || !panelBox) throw new Error('Missing microphone or panel box')
	expect(box.height).toBeGreaterThan(panelBox.height * 0.35)

	await mic.click()
	await expect(panel.getByRole('button', { name: 'Stop recording' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await expect(panel.getByText('Listening…')).toBeVisible()
	await expect(panel.locator('.ai-audio-timer')).not.toHaveText('0:00', { timeout: 4000 })

	await panel.getByRole('button', { name: 'Stop recording' }).click()
	await expect(panel.getByRole('button', { name: 'Start recording' })).toHaveAttribute(
		'aria-pressed',
		'false',
	)
	await expect(panel.getByText('Talk to Mico')).toBeVisible()

	await page.setViewportSize({ width: 667, height: 375 })
	await expect(panel).toBeVisible()
	const compactBox = await panel.getByRole('button', { name: 'Start recording' }).boundingBox()
	if (!compactBox) throw new Error('Missing compact microphone')
	expect(compactBox.height).toBeGreaterThan(90)

	const selectBox = await page.getByRole('button', { name: 'Select', exact: true }).boundingBox()
	if (!selectBox) throw new Error('Missing dock control')
	const dockOnTop = await page.evaluate(
		({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.toolbar')),
		{ x: selectBox.x + selectBox.width / 2, y: selectBox.y + selectBox.height / 2 },
	)
	expect(dockOnTop).toBe(true)
})

test('Escape cancels an active canvas gesture instead of closing the panel', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: AI_BUTTON, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await expect(panel).toBeVisible()
	await expect(panel.getByRole('textbox', { name: 'Message the assistant' })).toBeFocused()

	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await page.mouse.move(320, 320)
	await page.mouse.down()
	await page.mouse.move(420, 400)
	await page.keyboard.press('Escape')
	await page.mouse.up()

	await expect(panel).toBeVisible()
	await expect.poll(async () => (await board(request)).shapes.length).toBe(0)
})

test('the narrow Canvases panel stays above the AI panel', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await page.getByRole('button', { name: AI_BUTTON, exact: true }).click()
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()

	const canvases = page.getByRole('region', { name: 'Canvases' })
	await expect(canvases).toBeVisible()
	const onTop = await canvases.evaluate((element) => {
		const rect = element.getBoundingClientRect()
		const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + 20)
		return Boolean(hit && element.contains(hit))
	})
	expect(onTop).toBe(true)
})

test('the AI panel replaces the narrow properties sheet instead of hiding its controls underneath', async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await resetBoard(request, [
		{
			id: 'selected',
			type: 'rectangle',
			x: 120,
			y: 120,
			w: 180,
			h: 80,
			color: '#00a2e1',
			text: 'Selected',
		},
	])
	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await page.locator('[data-shape-id="selected"]').first().click()

	const properties = page.getByRole('region', { name: 'Selected object properties' })
	await expect(properties).toBeVisible()
	await page.getByRole('button', { name: AI_BUTTON, exact: true }).click()
	await expect(properties).toBeHidden()

	const composer = page
		.getByRole('region', { name: AI_BUTTON })
		.getByRole('textbox', { name: 'Message the assistant' })
	await composer.fill('Sketch a login flow')
	await expect(composer).toHaveValue('Sketch a login flow')
})
