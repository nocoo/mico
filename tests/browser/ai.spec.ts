import { expect, test } from '@playwright/test'
import { resetBoard } from './support'

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
})
