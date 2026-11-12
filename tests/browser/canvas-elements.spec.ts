import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { differingPixels } from './pixels'
import { ISOLATED_ORIGIN, resetBoard } from './support'

async function screenshotElement(page: Page, element: Locator, width = 200, height = 130) {
	const box = await element.boundingBox()
	if (!box) throw new Error('Missing canvas element')
	return page.screenshot({
		clip: {
			x: Math.round(box.x) - 20,
			y: Math.round(box.y) - 20,
			width: width + 40,
			height: height + 40,
		},
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

for (const item of [
	{ tool: 'rect', type: 'rectangle', color: '#00a2e1' },
	{ tool: 'ellipse', type: 'ellipse', color: '#f69143' },
] as const) {
	test(`manual ${item.type} matches the original prototype`, async ({
		page,
		context,
		request,
		baseURL,
	}) => {
		if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
		await resetBoard(request, [
			{ id: 'reference-shape', type: item.type, x: 400, y: 250, w: 170, h: 110, color: item.color },
		])
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.setViewportSize({ width: 1440, height: 960 })
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		await page.getByRole('button', { name: 'Reset view' }).click()
		await page.addStyleTag({
			content:
				'.app, .canvas-backdrop { background: white !important; } .canvas-aurora, .canvas-grain { display: none !important; } svg.canvas { background-image: none !important; }',
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
			await reference.locator(`#tools [data-tool="${item.tool}"]`).click()
			await reference.mouse.move(350, 350)
			await reference.mouse.down()
			await reference.mouse.move(520, 460, { steps: 4 })
			await reference.mouse.up()
			await reference.locator('#stage').click({ position: { x: 800, y: 700 } })
			const target = reference.locator(`.el-shape[data-by="user"][data-shape="${item.tool}"]`)
			await expect(target).toHaveCount(1)
			const expected = await screenshotElement(reference, target, 170, 110)
			const actual = await screenshotElement(
				page,
				page.locator('[data-shape-id="reference-shape"]'),
				170,
				110,
			)
			const diff = await differingPixels(page, expected, actual)
			expect(
				diff.different / diff.total,
				`${diff.different}/${diff.total} differing pixels`,
			).toBeLessThanOrEqual(0.001)
		} finally {
			await reference.close()
		}
	})
}

test('labelled flow node matches the original prototype', async ({
	page,
	context,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [
		{
			id: 'reference-node',
			type: 'rectangle',
			x: 400,
			y: 250,
			w: 196,
			h: 66,
			color: '#00a2e1',
			text: '传统：会议结束后\n生成 HTML 总结',
		},
	])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await page.getByRole('button', { name: 'Reset view' }).click()
	await page.addStyleTag({
		content:
			'.app, .canvas-backdrop { background: white !important; } .canvas-aurora, .canvas-grain { display: none !important; } svg.canvas { background-image: none !important; }',
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
				'.aurora, .grain, #edges { display: none !important; } #stage { background: white !important; } #world { transform: translate(0, 0) scale(1) !important; } .el.pop { animation: none !important; }',
		})
		await reference.locator('#hero-skip').click()
		const target = reference.locator('.el-node[data-id="n1"]')
		await expect(target).toHaveCount(1)
		const expected = await screenshotElement(reference, target, 196, 66)
		const actual = await screenshotElement(
			page,
			page.locator('[data-shape-id="reference-node"]'),
			196,
			66,
		)
		const diff = await differingPixels(page, expected, actual)
		expect(
			diff.different / diff.total,
			`${diff.different}/${diff.total} differing pixels`,
		).toBeLessThanOrEqual(0.001)
	} finally {
		await reference.close()
	}
})
