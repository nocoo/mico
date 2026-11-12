import { expect, test } from '@playwright/test'
import { ISOLATED_ORIGIN, resetBoard } from './support'

test('select controls avoid pointer focus rings while retaining keyboard focus', async ({
	page,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

	const recording = page.locator('.lesson .select-trigger')
	await recording.click()
	await page.getByRole('option').nth(1).click()
	await expect(recording).toBeFocused()
	await expect(recording).toHaveAttribute('data-pointer-focus', 'true')
	await expect(recording).toHaveCSS('outline-style', 'none')
	await page.keyboard.press('Tab')
	await page.keyboard.press('Shift+Tab')
	await expect(recording).toBeFocused()
	await expect(recording).toHaveCSS('outline-style', 'solid')
	await page.keyboard.press('Enter')
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('Enter')
	await expect(recording).toBeFocused()
	await expect(recording).not.toHaveAttribute('data-pointer-focus', 'true')
	await expect(recording).toHaveCSS('outline-style', 'solid')

	await page.getByRole('button', { name: 'Text', exact: true }).click()
	const font = page.getByRole('combobox', { name: 'Font family', exact: true })
	await font.click()
	await page.getByRole('option', { name: 'Hand', exact: true }).click()
	await expect(font).toBeFocused()
	await expect(font).toHaveAttribute('data-pointer-focus', 'true')
	await expect(font).toHaveCSS('outline-style', 'none')
	await page.keyboard.press('Tab')
	await page.keyboard.press('Shift+Tab')
	await expect(font).toBeFocused()
	await expect(font).toHaveCSS('outline-style', 'solid')
})
