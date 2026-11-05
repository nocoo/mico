import { expect, test } from '@playwright/test'
import { board, resetBoard } from './support'

const AI_BUTTON = 'AI assistant'
const OPEN_AI = 'Open AI assistant'
const COMPOSER = 'Message the assistant'

test.beforeEach(async ({ page, request }) => {
	await resetBoard(request, [])
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
})

test('the project logo and pen use their original containers and actions', async ({
	page,
	request,
}) => {
	await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/logo.png')
	const image = await request.get('/logo.png')
	expect(image.ok()).toBe(true)
	expect(image.headers()['content-type']).toContain('image/png')

	const logo = page.locator('.identity-panel img.brand-mark-icon')
	await expect(logo).toHaveAttribute('src', '/logo.png')
	await expect
		.poll(() => logo.evaluate((element: HTMLImageElement) => element.naturalWidth))
		.toBe(256)
	await expect(page.locator('.identity-panel').getByRole('status')).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Canvases', exact: true })).toBeVisible()

	const trigger = page.locator('[data-ai-toggle="true"]')
	await expect(trigger).toHaveAttribute('aria-label', OPEN_AI)
	await expect(trigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
	await expect(trigger).toHaveCSS('box-shadow', 'none')
	const pen = trigger.locator('svg.trigger-logo.lucide-pen-tool')
	await expect(pen).toHaveCSS('opacity', '1')
	const status = page.locator('.ai-trigger').getByRole('status', { name: 'Live' })
	const statusDot = status.locator('.status-dot')
	await expect(status).toBeVisible()
	const logoBox = await logo.boundingBox()
	const triggerBox = await trigger.boundingBox()
	const penBox = await pen.boundingBox()
	const statusBox = await status.boundingBox()
	if (!logoBox || !triggerBox || !penBox || !statusBox) throw new Error('Missing header icons')
	expect(logoBox.x).toBeLessThan(triggerBox.x)
	expect(statusBox.x + statusBox.width / 2).toBeCloseTo(penBox.x + 3, 0)
	expect(statusBox.y + statusBox.height / 2).toBeCloseTo(penBox.y + 3, 0)
	await expect(statusDot).toBeVisible()
	await expect(statusDot).toHaveCSS('animation-name', 'connection-status-breathe')
	await trigger.click()
	await expect(trigger).toHaveAttribute('aria-label', 'Close AI assistant')
	await expect(pen).toHaveCSS('opacity', '0')
	const close = trigger.locator('svg.trigger-close')
	await expect(close).toHaveCSS('opacity', '1')
	await expect(status).toHaveAttribute('aria-label', 'Live')
	await expect(statusDot).toBeHidden()
	await page.getByRole('tab', { name: 'Live' }).click()
	await expect(statusDot).toBeHidden()
	await trigger.click()
	await expect(pen).toHaveCSS('opacity', '1')
	await expect(statusDot).toBeVisible()
})

test('the AI panel streams a tool loop and draws on the board', async ({ page, request }) => {
	const trigger = page.locator('[data-ai-toggle="true"]')
	await expect(trigger).toHaveAttribute('aria-label', OPEN_AI)
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
	await trigger.click()
	await expect(trigger).toHaveAttribute('aria-label', 'Close AI assistant')
	await expect(trigger).toHaveAttribute('aria-expanded', 'true')

	const panel = page.getByRole('region', { name: AI_BUTTON })
	await expect(panel).toBeVisible()
	await expect(panel.getByText('Draw a lesson with Mico')).toBeVisible()
	for (const name of ['Chat', 'Audio', 'Live', 'Settings']) {
		await expect(panel.getByRole('tab', { name })).toHaveText(name)
	}

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
	await expect(trigger).toHaveAttribute('aria-label', OPEN_AI)
	await expect(trigger).toBeFocused()

	await trigger.click()
	await expect(trigger).toHaveAttribute('aria-label', 'Close AI assistant')
	await expect(panel.locator('.ai-message.user .ai-message-text')).toHaveText(
		'Draw projectile motion',
	)
})

test('the Audio tab loads prerecorded sessions and playback controls', async ({ page }) => {
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Audio' }).click()
	await expect(panel.getByRole('tab', { name: 'Audio' })).toHaveAttribute('aria-selected', 'true')
	const prerecorded = panel.getByRole('tabpanel', { name: 'Audio' })
	await expect(prerecorded.getByText('Live transcript')).toBeVisible()
	await expect(
		prerecorded.getByRole('button', { name: 'Play recording', exact: true }),
	).toBeVisible()
	await expect(prerecorded.getByRole('button', { name: 'New canvas' })).toBeVisible()
	await expect(prerecorded.getByRole('button', { name: 'Create session summary' })).toBeVisible()
	await expect(prerecorded.locator('.lesson-wave')).toBeVisible()
	await expect(prerecorded.getByText('Confirmed segments')).toBeVisible()
	const lesson = prerecorded.locator('.lesson')
	await expect
		.poll(() => lesson.evaluate((el) => el.scrollHeight - el.clientHeight))
		.toBeGreaterThan(0)
	const summary = prerecorded.getByRole('button', { name: 'Create session summary' })
	await summary.scrollIntoViewIfNeeded()
	await expect(summary).toBeVisible()
	const segments = prerecorded.locator('.lesson-segments')
	await segments.scrollIntoViewIfNeeded()
	await expect(segments).toBeVisible()
	const panelBox = await panel.boundingBox()
	if (!panelBox) throw new Error('Missing live panel layout')
	expect(panelBox.height).toBe(700)

	const picker = panel.getByRole('combobox', { name: 'Recording', exact: true })
	await expect(picker).toBeVisible()
	await expect(picker).toContainText('中文 · 物理 · 斜面、定滑轮与摩擦：连接体受力分析')
	await picker.click()
	await expect(page.getByRole('option')).toHaveCount(20)
	await page.keyboard.press('Escape')
})

test('AI settings save endpoint and model without exposing or accidentally clearing the key', async ({
	page,
	request,
}) => {
	const initial = await request.put('/api/ai/settings', {
		data: { baseURL: 'http://127.0.0.1:3425/v1', model: 'auto/gpt-6-luna', apiKey: 'initial-key' },
	})
	expect(initial.ok()).toBe(true)
	const writes: unknown[] = []
	page.on('request', (req) => {
		if (req.method() === 'PUT' && req.url().endsWith('/api/ai/settings')) {
			writes.push(req.postDataJSON())
		}
	})
	await page.reload()
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Chat' }).focus()
	await page.keyboard.press('End')
	await expect(panel.getByRole('tab', { name: 'Settings' })).toBeFocused()
	const settings = panel.getByRole('tabpanel', { name: 'Settings' })
	await expect(settings.getByLabel('Endpoint')).toHaveValue('http://127.0.0.1:3425/v1')
	await expect(settings.locator('.rt-TextFieldRoot')).toHaveCount(3)
	const fieldBox = await settings.locator('.rt-TextFieldRoot').first().boundingBox()
	const checkboxBox = await settings.getByRole('checkbox').boundingBox()
	const saveBox = await settings.getByRole('button', { name: 'Save settings' }).boundingBox()
	expect(fieldBox?.height).toBe(40)
	expect(checkboxBox?.height).toBe(16)
	expect(saveBox?.height).toBe(32)
	await settings.getByLabel('Endpoint').fill('https://example.test/v1')
	await settings.getByLabel('Model', { exact: true }).fill('example-model')
	await settings.getByRole('button', { name: 'Save settings' }).click()
	await expect(settings.getByRole('status')).toHaveText('Settings saved.')
	expect(writes[0]).toEqual({ baseURL: 'https://example.test/v1', model: 'example-model' })

	await settings.getByLabel('API key', { exact: true }).fill('example-key')
	await settings.getByRole('button', { name: 'Save settings' }).click()
	await expect(settings.getByLabel('API key', { exact: true })).toHaveValue('')
	expect(writes[1]).toEqual({
		baseURL: 'https://example.test/v1',
		model: 'example-model',
		apiKey: 'example-key',
	})

	await settings.getByLabel('Remove current API key').check()
	await settings.getByRole('button', { name: 'Save settings' }).click()
	await expect(settings.getByLabel('Remove current API key')).toHaveCount(0)
	expect(writes[2]).toEqual({
		baseURL: 'https://example.test/v1',
		model: 'example-model',
		apiKey: '',
	})
	await page.reload()
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	await panel.getByRole('tab', { name: 'Settings' }).click()
	await expect(settings.getByLabel('Endpoint')).toHaveValue('https://example.test/v1')
	await expect(settings.getByLabel('Model', { exact: true })).toHaveValue('example-model')
	await expect(settings.getByLabel('Remove current API key')).toHaveCount(0)
	const result = await request.get('/api/ai/settings')
	expect(await result.json()).toEqual({
		baseURL: 'https://example.test/v1',
		model: 'example-model',
		hasApiKey: false,
	})
})

test('a second turn keeps the conversation and the tool history valid', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
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
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
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

	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
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
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('textbox', { name: COMPOSER }).fill('Draw something')
	await panel.getByRole('textbox', { name: COMPOSER }).press('Enter')
	await expect(panel.getByRole('alert')).toContainText('Assistant request failed')
	await expect(panel.getByRole('alert')).toContainText('Settings')

	const composer = panel.getByRole('textbox', { name: COMPOSER })
	await composer.fill('Keep this draft')
	await panel.getByRole('button', { name: 'Continue' }).click()
	await expect(composer).toHaveValue('Keep this draft')
})

test('Live defaults to MOSS and can switch to MAI without starting a session', async ({ page }) => {
	let sessions = 0
	page.on('request', (request) => {
		if (request.url().includes('/api/moss/session')) sessions++
	})
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Live' }).click()
	const moss = panel.getByRole('radio', { name: 'MOSS Live' })
	const mai = panel.getByRole('radio', { name: 'MAI Transcribe' })
	await expect(moss).toHaveAttribute('data-state', 'on')
	await expect(mai).toHaveAttribute('data-state', 'off')
	await mai.click()
	await expect(mai).toHaveAttribute('data-state', 'on')
	await expect(panel.getByRole('button', { name: 'Start recording' })).toBeVisible()
	await moss.click()
	await expect(moss).toHaveAttribute('data-state', 'on')
	expect(sessions).toBe(0)
})

test('the Live tab preserves the microphone layout', async ({ page }) => {
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Live' }).click()
	await expect(panel.getByRole('tab', { name: 'Live' })).toHaveAttribute('aria-selected', 'true')
	await expect(panel.getByRole('tabpanel', { name: 'Live' })).toBeVisible()

	const mic = panel.getByRole('button', { name: 'Start recording' })
	await expect(mic).toBeVisible()
	await expect(mic).toHaveAttribute('aria-pressed', 'false')
	const box = await mic.boundingBox()
	const panelBox = await panel.boundingBox()
	if (!box || !panelBox) throw new Error('Missing microphone or panel box')
	expect(box.height).toBe(64)

	await page.setViewportSize({ width: 667, height: 375 })
	await expect(panel).toBeVisible()
	const compactBox = await panel.getByRole('button', { name: 'Start recording' }).boundingBox()
	if (!compactBox) throw new Error('Missing compact microphone')
	expect(compactBox.height).toBe(64)

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
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
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
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
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
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
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
			type: 'text',
			x: 120,
			y: 120,
			w: 180,
			h: 80,
			color: '#263248',
			text: 'Selected',
			font: 'serif',
			fontSize: 24,
			fontWeight: 400,
		},
	])
	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await page.locator('[data-shape-id="selected"]').first().click()

	const properties = page.getByRole('region', { name: 'Selected object properties' })
	await expect(properties).toBeVisible()
	await expect(
		properties.getByRole('combobox', { name: 'Font family', exact: true }),
	).toContainText('Serif')
	await expect(properties.getByRole('combobox', { name: 'Font size', exact: true })).toContainText(
		'24',
	)
	await expect(
		properties.getByRole('combobox', { name: 'Font weight', exact: true }),
	).toContainText('400')
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	await expect(properties).toBeHidden()

	const composer = page
		.getByRole('region', { name: AI_BUTTON })
		.getByRole('textbox', { name: COMPOSER })
	await composer.fill('Sketch a login flow')
	await expect(composer).toHaveValue('Sketch a login flow')
})
