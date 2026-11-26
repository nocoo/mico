import { expect } from '@playwright/test'
import { board, openAssistant, resetBoard, test } from './support'

const OPEN_AI = 'Open AI assistant'
const COMPOSER = 'Message the assistant'

test.beforeEach(async ({ page, request }) => {
	await resetBoard(request, [])
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
})

test('the AI panel streams a tool loop and draws on the board', async ({ page, request }) => {
	const trigger = page.locator('[data-ai-toggle="true"]')
	await expect(trigger).toHaveAttribute('aria-label', 'Close AI assistant')
	await expect(trigger).toHaveAttribute('aria-expanded', 'true')
	const panel = await openAssistant(page, 'Chat')
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
	const panel = await openAssistant(page, 'Audio')
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
	const summary = prerecorded.getByRole('button', { name: 'Create session summary' })
	await summary.scrollIntoViewIfNeeded()
	await expect(summary).toBeVisible()
	const segments = prerecorded.locator('.lesson-segments')
	await segments.scrollIntoViewIfNeeded()
	await expect(segments).toBeVisible()
	const panelBox = await panel.boundingBox()
	const lessonBox = await lesson.boundingBox()
	const segmentsBox = await segments.boundingBox()
	if (!panelBox || !lessonBox || !segmentsBox) throw new Error('Missing live panel layout')
	expect(segmentsBox.y + segmentsBox.height).toBeLessThanOrEqual(lessonBox.y + lessonBox.height + 1)
	expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(960)

	const manifestResponse = await page.request.get('/evals/manifest.json')
	expect(manifestResponse.ok()).toBe(true)
	const manifest = (await manifestResponse.json()) as { evals?: unknown[] }
	expect(manifest.evals?.length).toBeGreaterThan(0)

	const picker = panel.getByRole('combobox', { name: 'Recording', exact: true })
	await expect(picker).toBeVisible()
	await expect(picker).toContainText('中文 · 物理 · 斜面、定滑轮与摩擦：连接体受力分析')
	await picker.click()
	await expect(page.getByRole('option')).toHaveCount(manifest.evals?.length ?? 0)
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
	await page.route('**/api/ai/models', (route) => route.fulfill({ json: { models: [] } }))
	const writes: unknown[] = []
	page.on('request', (req) => {
		if (req.method() === 'PUT' && req.url().endsWith('/api/ai/settings')) {
			writes.push(req.postDataJSON())
		}
	})
	await page.reload()
	const panel = await openAssistant(page, 'Chat')
	await panel.getByRole('tab', { name: 'Chat' }).focus()
	await page.keyboard.press('End')
	await expect(panel.getByRole('tab', { name: 'Settings' })).toBeFocused()
	const settings = panel.getByRole('tabpanel', { name: 'Settings' })
	await expect(settings.getByLabel('Endpoint')).toHaveValue('http://127.0.0.1:3425/v1')
	await expect(settings.locator('.rt-TextFieldRoot')).toHaveCount(3)
	await settings.getByLabel('Endpoint').fill('https://example.test/v1')
	await settings.getByLabel('Model', { exact: true }).fill('example-model')
	await settings.getByRole('combobox', { name: 'Live / Audio reasoning' }).click()
	await page.getByRole('option', { name: 'Minimal', exact: true }).click()
	await settings.getByRole('combobox', { name: 'Chat reasoning' }).click()
	await page.getByRole('option', { name: 'High', exact: true }).click()
	await settings.getByRole('button', { name: 'Save settings' }).click()
	await expect(settings.getByRole('status')).toHaveText('Settings saved.')
	expect(writes[0]).toEqual({
		baseURL: 'https://example.test/v1',
		model: 'example-model',
		lectureReasoning: 'minimal',
		chatReasoning: 'high',
	})

	await settings.getByLabel('API key', { exact: true }).fill('example-key')
	await settings.getByRole('button', { name: 'Save settings' }).click()
	await expect(settings.getByLabel('API key', { exact: true })).toHaveValue('')
	expect(writes[1]).toEqual({
		baseURL: 'https://example.test/v1',
		model: 'example-model',
		lectureReasoning: 'minimal',
		chatReasoning: 'high',
		apiKey: 'example-key',
	})

	await settings.getByLabel('Remove current API key').check()
	await settings.getByRole('button', { name: 'Save settings' }).click()
	await expect(settings.getByLabel('Remove current API key')).toHaveCount(0)
	expect(writes[2]).toEqual({
		baseURL: 'https://example.test/v1',
		model: 'example-model',
		lectureReasoning: 'minimal',
		chatReasoning: 'high',
		apiKey: '',
	})
	await page.reload()
	await openAssistant(page, 'Settings')
	await expect(settings.getByLabel('Endpoint')).toHaveValue('https://example.test/v1')
	await expect(settings.getByLabel('Model', { exact: true })).toHaveValue('example-model')
	await expect(settings.getByRole('combobox', { name: 'Live / Audio reasoning' })).toHaveText(
		'Minimal',
	)
	await expect(settings.getByRole('combobox', { name: 'Chat reasoning' })).toHaveText('High')
	await expect(settings.getByLabel('Remove current API key')).toHaveCount(0)
	const result = await request.get('/api/ai/settings')
	expect(await result.json()).toEqual({
		baseURL: 'https://example.test/v1',
		model: 'example-model',
		hasApiKey: false,
		readOnly: false,
		authMode: 'api-key',
		lectureReasoning: 'minimal',
		chatReasoning: 'high',
	})
})
