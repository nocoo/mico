import { expect, test } from '@playwright/test'
import { board, resetBoard } from './support'

const AI_BUTTON = 'AI assistant'
const COMPOSER = 'Message the assistant'

test.beforeEach(async ({ page, request }) => {
	await resetBoard(request, [])
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
})

test('the AI panel streams a tool loop and draws on the board', async ({ page, request }) => {
	const trigger = page.getByRole('button', { name: AI_BUTTON, exact: true })
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
	await trigger.click()
	await expect(trigger).toHaveAttribute('aria-expanded', 'true')

	const panel = page.getByRole('region', { name: AI_BUTTON })
	await expect(panel).toBeVisible()
	await expect(panel.getByText('Draw a lesson with Mico')).toBeVisible()

	const composer = panel.getByRole('textbox', { name: COMPOSER })
	await composer.fill('Draw projectile motion')
	await composer.press('Enter')
	await expect(panel.locator('.ai-message.user .ai-message-text')).toHaveText(
		'Draw projectile motion',
	)

	await expect(panel.locator('.ai-tool').first()).toBeVisible()
	await expect(panel.getByText('The diagram is ready', { exact: false })).toBeVisible({
		timeout: 15_000,
	})
	await expect.poll(async () => (await board(request)).shapes.length).toBe(8)
	const shapes = (await board(request)).shapes
	expect(shapes.some((shape) => shape.id === 'mock-1-title' && shape.type === 'text')).toBe(true)
	expect(shapes.some((shape) => shape.id === 'mock-1-flow' && shape.type === 'connector')).toBe(
		true,
	)
	await expect(panel.locator('.ai-tool.done').first()).toBeVisible()

	await page.keyboard.press('Escape')
	await expect(panel).toBeHidden()
	await expect(trigger).toBeFocused()

	await trigger.click()
	await expect(panel.locator('.ai-message.user .ai-message-text')).toHaveText(
		'Draw projectile motion',
	)
})

test('a second turn keeps the conversation and the tool history valid', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: AI_BUTTON, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	const composer = panel.getByRole('textbox', { name: COMPOSER })
	await composer.fill('Draw projectile motion')
	await composer.press('Enter')
	await expect(panel.getByRole('button', { name: 'Send message' })).toBeVisible({
		timeout: 15_000,
	})
	await expect.poll(async () => (await board(request)).shapes.length).toBe(8)

	await composer.fill('Now add the same diagram again')
	await composer.press('Enter')
	await expect(panel.getByRole('button', { name: 'Send message' })).toBeVisible({
		timeout: 15_000,
	})
	await expect.poll(async () => (await board(request)).shapes.length).toBe(16)
	await expect(panel.locator('.ai-message.assistant')).toHaveCount(2)
	await expect(panel.locator('.ai-tool.failed')).toHaveCount(0)
})

test('quick prompts draw without typing', async ({ page, request }) => {
	await page.getByRole('button', { name: AI_BUTTON, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('button', { name: 'Projectile motion' }).click()
	await expect.poll(async () => (await board(request)).shapes.length).toBe(8)
	await expect(panel.locator('.ai-message.user .ai-message-text')).toContainText(
		'projectile motion',
	)
})

test('a URL prompt opens the panel and starts the lesson', async ({ page, request }) => {
	await page.goto('/?ai=Explain%20and%20draw%20projectile%20motion')
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await expect(panel).toBeVisible()
	await expect.poll(async () => (await board(request)).shapes.length).toBe(8)
	await expect(panel.getByRole('textbox', { name: COMPOSER })).toHaveValue('')
})

test('the current marquee selection is attached to the request', async ({ page, request }) => {
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

	let sent: { selection?: string[] } | undefined
	await page.route('**/api/ai/chat', async (route) => {
		sent = route.request().postDataJSON() as { selection?: string[] }
		await route.continue()
	})

	await page.getByRole('button', { name: AI_BUTTON, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await expect(panel.getByText('1 selected object attached')).toBeVisible()
	await panel.getByRole('textbox', { name: COMPOSER }).fill('Extend the selected object')
	await panel.getByRole('textbox', { name: COMPOSER }).press('Enter')

	await expect.poll(() => sent?.selection).toEqual(['selected'])
})

test('a failed gateway response shows an actionable error', async ({ page }) => {
	await page.route('**/api/ai/chat', (route) =>
		route.fulfill({
			status: 500,
			contentType: 'application/json',
			body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'gateway down' }),
		}),
	)
	await page.getByRole('button', { name: AI_BUTTON, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('textbox', { name: COMPOSER }).fill('Draw something')
	await panel.getByRole('textbox', { name: COMPOSER }).press('Enter')
	await expect(panel.getByRole('alert')).toContainText('Assistant request failed')
	await expect(panel.getByRole('alert')).toContainText('127.0.0.1:3425')
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
	expect(compactBox.height).toBeGreaterThan(70)

	await panel.getByRole('tab', { name: 'Chat' }).click()
	const shortComposer = panel.getByRole('textbox', { name: COMPOSER })
	await expect(shortComposer).toBeVisible()
	const composerBox = await shortComposer.boundingBox()
	if (!composerBox) throw new Error('Missing compact composer')
	const dockBox = await page.locator('.toolbar').boundingBox()
	if (!dockBox) throw new Error('Missing dock')
	expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(dockBox.y)
	const composerOnTop = await page.evaluate(
		({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.ai-composer')),
		{ x: composerBox.x + composerBox.width / 2, y: composerBox.y + composerBox.height / 2 },
	)
	expect(composerOnTop).toBe(true)

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
	await expect(panel.getByRole('textbox', { name: COMPOSER })).toBeFocused()

	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await page.mouse.move(320, 320)
	await page.mouse.down()
	await page.mouse.move(420, 400)
	await page.keyboard.press('Escape')
	await page.mouse.up()

	await expect(panel).toBeVisible()
	await expect.poll(async () => (await board(request)).shapes.length).toBe(0)
})

test('Escape closes the panel when keyboard focus is back in the composer', async ({ page }) => {
	await page.getByRole('button', { name: AI_BUTTON, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await panel.getByRole('textbox', { name: COMPOSER }).focus()
	await page.keyboard.press('Escape')
	await expect(panel).toBeHidden()
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
		.getByRole('textbox', { name: COMPOSER })
	await composer.fill('Sketch a login flow')
	await expect(composer).toHaveValue('Sketch a login flow')
})
