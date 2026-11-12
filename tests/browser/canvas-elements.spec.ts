import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { differingPixels } from './pixels'
import { ISOLATED_ORIGIN, resetBoard } from './support'

async function screenshotElement(page: Page, element: Locator) {
	const box = await element.boundingBox()
	if (!box) throw new Error('Missing canvas element')
	return page.screenshot({
		clip: { x: Math.round(box.x) - 20, y: Math.round(box.y) - 20, width: 240, height: 170 },
		animations: 'disabled',
	})
}

test('manual sticky note matches the original prototype', async ({
	page,
	context,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [
		{
			id: 'reference-note',
			type: 'note',
			x: 400,
			y: 250,
			w: 200,
			h: 130,
			color: '#fff8d4',
			text: 'Prototype note\nSecond line',
		},
	])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await page.getByRole('button', { name: 'Reset view' }).click()
	await page.addStyleTag({
		content: `
		.app, .canvas-backdrop { background: white !important; }
		.canvas-aurora, .canvas-grain { display: none !important; }
		svg.canvas { background-image: none !important; }
	`,
	})
	const reference = await context.newPage()
	await reference.setViewportSize({ width: 1440, height: 960 })
	await reference.emulateMedia({ reducedMotion: 'reduce' })
	await reference.goto(
		pathToFileURL(resolve(process.cwd(), 'docs/prototypes/teams-ai-whiteboard.html')).href,
	)
	try {
		await reference.addStyleTag({
			content:
				'.aurora, .grain, #hero { display: none !important; } #stage { background: white !important; } .el.pop { animation: none !important; }',
		})
		await reference.locator('#tools [data-tool="sticky"]').click()
		await reference.locator('#stage').click({ position: { x: 400, y: 350 } })
		const edit = reference.locator('.el-sticky [contenteditable]')
		await edit.fill('Prototype note\nSecond line')
		await reference.locator('#stage').click({ position: { x: 800, y: 700 } })
		const target = reference.locator('.el-sticky[data-by="user"]')
		await expect(target).toHaveCount(1)
		const expected = await screenshotElement(reference, target)
		const actual = await screenshotElement(page, page.locator('[data-shape-id="reference-note"]'))
		const diff = await differingPixels(page, expected, actual)
		expect(
			diff.different / diff.total,
			`${diff.different}/${diff.total} differing pixels`,
		).toBeLessThanOrEqual(0.001)
	} finally {
		await reference.close()
	}
})
