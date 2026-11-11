import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { ISOLATED_ORIGIN, resetBoard } from './support'

async function differingPixels(page: Page, reference: Buffer, actual: Buffer) {
	return page.evaluate(
		async ({ reference, actual }) => {
			const image = async (data: string) => {
				const response = await fetch(`data:image/png;base64,${data}`)
				return createImageBitmap(await response.blob())
			}
			const [expected, received] = await Promise.all([image(reference), image(actual)])
			if (expected.width !== received.width || expected.height !== received.height) {
				throw new Error(
					`Image sizes differ: ${expected.width}×${expected.height} vs ${received.width}×${received.height}`,
				)
			}
			const canvas = document.createElement('canvas')
			canvas.width = expected.width
			canvas.height = expected.height
			const context = canvas.getContext('2d', { willReadFrequently: true })
			if (!context) throw new Error('Canvas context unavailable')
			context.drawImage(expected, 0, 0)
			const a = context.getImageData(0, 0, canvas.width, canvas.height).data
			context.clearRect(0, 0, canvas.width, canvas.height)
			context.drawImage(received, 0, 0)
			const b = context.getImageData(0, 0, canvas.width, canvas.height).data
			let different = 0
			for (let i = 0; i < a.length; i += 4) {
				if ([0, 1, 2, 3].some((channel) => Math.abs(a[i + channel] - b[i + channel]) > 5.1))
					different++
			}
			expected.close()
			received.close()
			return { different, total: canvas.width * canvas.height }
		},
		{ reference: reference.toString('base64'), actual: actual.toString('base64') },
	)
}

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
		.canvas { visibility: hidden !important; }
		.frame-empty { top: 200px !important; left: 0 !important; translate: none !important; }
		.identity-panel > * { visibility: hidden !important; }
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
			['glass', '#surface', '.identity-panel'],
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
