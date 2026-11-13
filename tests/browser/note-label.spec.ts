import { expect, test } from '@playwright/test'
import { closeAssistant, ISOLATED_ORIGIN, resetBoard, resetView, shapeOf } from './support'

test('adding a label preserves existing note text and is one undo step', async ({
	page,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [
		{
			id: 'full-note',
			type: 'note',
			x: 400,
			y: 250,
			w: 260,
			h: 140,
			color: '#fff8d4',
			text: 'One\nTwo\nThree\nFour\nFive',
		},
	])
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await resetView(page)
	const body = page.locator('[data-shape-id="full-note"] .sticky-body')
	const fits = () => body.evaluate((element) => element.scrollHeight <= element.clientHeight)
	expect(await fits()).toBe(true)
	await page.locator('[data-shape-id="full-note"] rect').first().click()
	const label = page.getByLabel('Label', { exact: true })
	await label.fill('Risk')
	await label.press('Enter')
	await expect.poll(async () => (await shapeOf(request, 'full-note')).h).toBe(159)
	await expect(page.locator('[data-shape-id="full-note"] .sticky-chip')).toHaveText('Risk')
	expect(await fits()).toBe(true)
	await expect(body).toHaveText('One\nTwo\nThree\nFour\nFive')
	const undo = page.getByRole('button', { name: 'Undo' })
	await expect(undo).toBeEnabled()
	await undo.click()
	await expect.poll(async () => (await shapeOf(request, 'full-note')).h).toBe(140)
	await expect(page.locator('[data-shape-id="full-note"] .sticky-chip')).toHaveCount(0)
	expect(await fits()).toBe(true)
})
