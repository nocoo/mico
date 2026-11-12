import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { differingPixels } from './pixels'
import { ISOLATED_ORIGIN, resetBoard } from './support'

test('canvas backdrop matches the reference at rest, pan and zoom', async ({
	page,
	context,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await page.addStyleTag({
		content: `
		.app > :not(.canvas-backdrop):not(.canvas-grain):not(svg.canvas) { display: none !important; }
		svg.canvas > * { visibility: hidden !important; }
	`,
	})
	const reference = await context.newPage()
	await reference.setViewportSize({ width: 1440, height: 960 })
	await reference.emulateMedia({ reducedMotion: 'reduce' })
	await reference.goto(
		pathToFileURL(resolve(process.cwd(), 'docs/prototypes/canvas-reference.html')).href,
	)
	try {
		for (const state of ['rest', 'pan', 'zoom'] as const) {
			if (state === 'pan') {
				await page.keyboard.press('h')
				await page.mouse.move(600, 500)
				await page.mouse.down()
				await page.mouse.move(427, 414, { steps: 4 })
				await page.mouse.up()
			} else if (state === 'zoom') {
				await page.mouse.move(700, 500)
				await page.mouse.wheel(0, -180)
			}
			const grid = await page.locator('svg.canvas').evaluate((element) => {
				const style = getComputedStyle(element)
				return {
					spacing: style.getPropertyValue('--canvas-grid-size'),
					x: style.getPropertyValue('--canvas-grid-x'),
					y: style.getPropertyValue('--canvas-grid-y'),
				}
			})
			if (state === 'pan') {
				expect(Number.parseFloat(grid.x)).toBe(-173)
				expect(Number.parseFloat(grid.y)).toBe(-86)
			}
			if (state === 'zoom') expect(Number.parseFloat(grid.spacing)).toBeGreaterThan(24)
			await reference.locator('#stage').evaluate((element, value) => {
				element.style.setProperty('--gs', value.spacing)
				element.style.setProperty('--gx', value.x)
				element.style.setProperty('--gy', value.y)
			}, grid)
			const expected = await reference.screenshot({ animations: 'disabled' })
			const actual = await page.screenshot({ animations: 'disabled' })
			const diff = await differingPixels(page, expected, actual)
			expect(
				diff.different / diff.total,
				`${state}: ${diff.different}/${diff.total} differing pixels`,
			).toBeLessThanOrEqual(0.001)
		}
	} finally {
		await reference.close()
	}
})
