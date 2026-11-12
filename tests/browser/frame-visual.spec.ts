import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { differingPixels } from './pixels'
import { ISOLATED_ORIGIN, resetBoard } from './support'

test('reference glass, jelly orbs and active tool match at pixel level', async ({
	page,
	context,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await expect(page.locator('.frame-empty')).toBeVisible()
	await page.addStyleTag({
		content: `
		.app { background: white !important; }
		.canvas, .canvas-backdrop, .canvas-grain { visibility: hidden !important; }
		.frame-empty { top: 200px !important; left: 0 !important; translate: none !important; }
		.ai-status-pill { top: 600px !important; left: 100px !important; bottom: auto !important; width: 160px !important; max-width: none !important; transform: none !important; }
		.ai-status-pill > * { visibility: hidden !important; }
		.toolbar-module.toolbar { background: white !important; backdrop-filter: none !important; box-shadow: none !important; }
		.toolbar-module.toolbar::before { display: none !important; }
		.toolbar-module .drawing-tools .icon-button > svg { visibility: hidden !important; }
	`,
	})
	const reference = await context.newPage()
	await reference.emulateMedia({ reducedMotion: 'reduce' })
	await reference.goto(
		pathToFileURL(resolve(process.cwd(), 'docs/prototypes/frame-reference-fragments.html')).href,
	)
	try {
		for (const [label, expectedSelector, actualSelector] of [
			['glass', '#surface', '.ai-status-pill'],
			['jelly orbs', '.hero-orb', '.frame-empty-orb'],
			['active tool', '.ib.on', '.tool-slot[data-tool-id="select"] button'],
		] as const) {
			const expected = await reference
				.locator(expectedSelector)
				.screenshot({ animations: 'disabled' })
			const actual = await page.locator(actualSelector).screenshot({ animations: 'disabled' })
			const diff = await differingPixels(page, expected, actual)
			expect(
				diff.different / diff.total,
				`${label}: ${diff.different}/${diff.total} differing pixels`,
			).toBeLessThanOrEqual(0.001)
		}
	} finally {
		await reference.close()
	}
})
