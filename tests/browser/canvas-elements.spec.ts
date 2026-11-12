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
				'.aurora, .grain, #hero, #ctx { display: none !important; } #stage { background: white !important; } .el.pop { animation: none !important; }',
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
		await target.click()
		await page.locator('[data-shape-id="reference-note"] rect').first().click()
		await expect(page.locator('[data-shape-id="reference-note"] .selection')).toHaveCount(1)
		const selectedReference = await screenshotElement(reference, target)
		const selectedActual = await screenshotElement(
			page,
			page.locator('[data-shape-id="reference-note"] .sticky-jelly'),
		)
		const selectionDiff = await differingPixels(page, selectedReference, selectedActual)
		expect(
			selectionDiff.different / selectionDiff.total,
			`${selectionDiff.different}/${selectionDiff.total} differing selected pixels`,
		).toBeLessThanOrEqual(0.001)
		await page.addStyleTag({ content: '.selection-panel { display: none !important; }' })
		await page.mouse.move(500, 315)
		await page.mouse.wheel(0, -Math.log(2) / 0.0015)
		await expect
			.poll(() =>
				page
					.locator('[data-world-layer]')
					.evaluate(
						(element) => (element as SVGGElement).transform.baseVal.consolidate()?.matrix.a ?? 0,
					),
			)
			.toBeCloseTo(2, 3)
		const position = await target.evaluate((element) => ({
			x: Number.parseFloat(element.style.left),
			y: Number.parseFloat(element.style.top),
		}))
		await reference.locator('#world').evaluate((element, value) => {
			const world = element as HTMLElement
			world.style.transform = `translate(${200 - value.x * 2}px, ${200 - value.y * 2}px) scale(2)`
			world.style.setProperty('--inv', '0.5')
		}, position)
		const zoomedReference = await screenshotElement(reference, target, 400, 260)
		const zoomedActual = await screenshotElement(
			page,
			page.locator('[data-shape-id="reference-note"] .sticky-jelly'),
			400,
			260,
		)
		const zoomedDiff = await differingPixels(page, zoomedReference, zoomedActual)
		expect(
			zoomedDiff.different / zoomedDiff.total,
			`${zoomedDiff.different}/${zoomedDiff.total} differing zoomed pixels`,
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
					'.aurora, .grain, #hero, #ctx { display: none !important; } #stage { background: white !important; } .el.pop { animation: none !important; }',
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
			await target.click()
			await page.locator('[data-shape-id="reference-shape"]').click()
			await expect(page.locator('[data-shape-id="reference-shape"] .selection')).toHaveCount(1)
			const selectedReference = await screenshotElement(reference, target, 170, 110)
			const selectedActual = await screenshotElement(
				page,
				page.locator('[data-shape-id="reference-shape"] .jelly-shape'),
				170,
				110,
			)
			const selectionDiff = await differingPixels(page, selectedReference, selectedActual)
			expect(
				selectionDiff.different / selectionDiff.total,
				`${selectionDiff.different}/${selectionDiff.total} differing selected pixels`,
			).toBeLessThanOrEqual(0.001)
		} finally {
			await reference.close()
		}
	})
}

test('manual text matches the original prototype', async ({ page, context, request, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [
		{
			id: 'reference-text',
			type: 'text',
			x: 400,
			y: 250,
			w: 320,
			h: 27,
			color: '#2b3038',
			text: 'Prototype text',
			font: 'sans',
			fontSize: 18,
			fontWeight: 600,
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
				'.aurora, .grain, #hero { display: none !important; } #stage { background: white !important; } .el.pop { animation: none !important; }',
		})
		await reference.locator('#tools [data-tool="text"]').click()
		await reference.locator('#stage').click({ position: { x: 400, y: 350 } })
		await reference.locator('.el-text[contenteditable]').fill('Prototype text')
		await reference.locator('#stage').click({ position: { x: 800, y: 700 } })
		const target = reference.locator('.el-text[data-by="user"]')
		await expect(target).toHaveCount(1)
		const box = await target.boundingBox()
		if (!box) throw new Error('Missing reference text')
		const width = Math.ceil(box.width)
		const height = Math.ceil(box.height)
		const expected = await screenshotElement(reference, target, width, height)
		const actual = await screenshotElement(
			page,
			page.locator('[data-shape-id="reference-text"]'),
			width,
			height,
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

test('freehand pencil matches the original prototype', async ({
	page,
	context,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [
		{
			id: 'reference-ink',
			type: 'path',
			x: 400,
			y: 250,
			w: 100,
			h: 50,
			color: '#b799ff',
			brush: 'pencil',
			strokeWidth: 4,
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 50 },
			],
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
				'.aurora, .grain, #hero, #ctx { display: none !important; } #stage { background: white !important; }',
		})
		await reference.locator('#tools [data-tool="pen"]').click()
		await reference.mouse.move(350, 350)
		await reference.mouse.down()
		await reference.mouse.move(450, 400)
		await reference.mouse.up()
		const target = reference.locator('#ink .pen[data-by="user"]')
		await expect(target).toHaveCount(1)
		const expected = await screenshotElement(reference, target, 100, 50)
		const actual = await screenshotElement(
			page,
			page.locator('[data-shape-id="reference-ink"]'),
			100,
			50,
		)
		const diff = await differingPixels(page, expected, actual)
		expect(
			diff.different / diff.total,
			`${diff.different}/${diff.total} differing pixels`,
		).toBeLessThanOrEqual(0.001)
		await reference.locator('#tools [data-tool="select"]').click()
		await target.click()
		await page.locator('[data-shape-id="reference-ink"] path').click()
		const selectedReference = await screenshotElement(reference, target, 100, 50)
		const selectedActual = await screenshotElement(
			page,
			page.locator('[data-shape-id="reference-ink"]'),
			100,
			50,
		)
		const selectionDiff = await differingPixels(page, selectedReference, selectedActual)
		expect(
			selectionDiff.different / selectionDiff.total,
			`${selectionDiff.different}/${selectionDiff.total} differing selected pixels`,
		).toBeLessThanOrEqual(0.001)
	} finally {
		await reference.close()
	}
})

test('connector matches the original prototype between aligned nodes', async ({
	page,
	context,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [
		{
			id: 'from',
			type: 'rectangle',
			x: 560,
			y: 130,
			w: 196,
			h: 66,
			color: '#00a2e1',
			text: 'Start',
		},
		{ id: 'to', type: 'rectangle', x: 790, y: 130, w: 196, h: 66, color: '#00a2e1', text: 'End' },
		{
			id: 'edge',
			type: 'connector',
			from: 'from',
			to: 'to',
			fromAnchor: 3,
			toAnchor: 2,
			color: '#00a2e1',
		},
	])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await page.getByRole('button', { name: 'Reset view' }).click()
	await page.addStyleTag({
		content:
			'.app, .canvas-backdrop { background: white !important; } .canvas-aurora, .canvas-grain { display: none !important; } svg.canvas { background-image: none !important; } .canvas-shape:not(.connector) { visibility: hidden !important; }',
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
				'.aurora, .grain, #els, #ink, #aicur { display: none !important; } #stage { background: white !important; } #world { transform: translate(0, 0) scale(1) !important; }',
		})
		await reference.locator('#hero-skip').click()
		await expect(reference.locator('#edges .edge')).not.toHaveCount(0)
		const clip = { x: 748, y: 142, width: 54, height: 42 }
		const expected = await reference.screenshot({ clip, animations: 'disabled' })
		const actual = await page.screenshot({ clip, animations: 'disabled' })
		const diff = await differingPixels(page, expected, actual)
		expect(
			diff.different / diff.total,
			`${diff.different}/${diff.total} differing pixels`,
		).toBeLessThanOrEqual(0.001)
	} finally {
		await reference.close()
	}
})

test('HTML card surface and label match the original prototype', async ({
	page,
	context,
	request,
	baseURL,
}) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	const reference = await context.newPage()
	await reference.setViewportSize({ width: 1440, height: 960 })
	await reference.emulateMedia({ reducedMotion: 'reduce' })
	await reference.goto(
		pathToFileURL(resolve(process.cwd(), 'docs/prototypes/teams-ai-whiteboard.html')).href,
	)
	try {
		await reference.addStyleTag({
			content:
				'.aurora, .grain { display: none !important; } #stage { background: white !important; } #world { transform: translate(-700px, 0) scale(1) !important; } .el.pop { animation: none !important; }',
		})
		await reference.locator('#hero-skip').click()
		const target = reference.locator('.el-card')
		await expect(target).toHaveCount(1)
		const box = await target.boundingBox()
		if (!box) throw new Error('Missing reference card')
		await resetBoard(request, [
			{
				id: 'reference-card',
				type: 'html',
				x: 450,
				y: 110,
				w: 620,
				h: box.height,
				color: '#00a2e1',
				title: 'AI 原生白板：原型验证与产品边界',
				html: '',
			},
		])
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.setViewportSize({ width: 1440, height: 960 })
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		await page.getByRole('button', { name: 'Reset view' }).click()
		await page.addStyleTag({
			content:
				'.app, .canvas-backdrop { background: white !important; } .canvas-aurora, .canvas-grain { display: none !important; } svg.canvas { background-image: none !important; } .html-card-empty, .html-card-label-handle { visibility: hidden !important; } .ai-assistant, .toolbar-module, .topbar.frame-identity { display: none !important; }',
		})
		await reference.addStyleTag({
			content:
				'.el-card > * { visibility: hidden !important; } #panel, .topbar, .tools, #aistatus, .minimap { display: none !important; }',
		})
		const height = Math.ceil(box.height)
		const expected = await screenshotElement(reference, target, 620, height)
		const actual = await screenshotElement(
			page,
			page.locator('[data-shape-id="reference-card"] .html-card'),
			620,
			height,
		)
		const diff = await differingPixels(page, expected, actual)
		expect(
			diff.different / diff.total,
			`${diff.different}/${diff.total} differing card pixels`,
		).toBeLessThanOrEqual(0.001)
		await page.addStyleTag({
			content: '.html-card-label-handle { visibility: visible !important; }',
		})
		await reference.addStyleTag({
			content: '.el-card > .card-tab { visibility: visible !important; }',
		})
		const referenceLabel = reference.locator('.el-card .card-tab')
		const labelBox = await referenceLabel.boundingBox()
		if (!labelBox) throw new Error('Missing reference card label')
		const labelWidth = Math.ceil(labelBox.width)
		const labelHeight = Math.ceil(labelBox.height)
		const expectedLabel = await screenshotElement(
			reference,
			referenceLabel,
			labelWidth,
			labelHeight,
		)
		const actualLabel = await screenshotElement(
			page,
			page.locator('[data-card-handle="reference-card"] .card-pill'),
			labelWidth,
			labelHeight,
		)
		const labelDiff = await differingPixels(page, expectedLabel, actualLabel)
		expect(
			labelDiff.different / labelDiff.total,
			`${labelDiff.different}/${labelDiff.total} differing label pixels`,
		).toBeLessThanOrEqual(0.001)
	} finally {
		await reference.close()
	}
})

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
