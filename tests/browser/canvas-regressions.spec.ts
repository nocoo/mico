import { expect, test } from '@playwright/test'
import {
	closeAssistant,
	ISOLATED_ORIGIN,
	resetBoard,
	resetView,
	worldPoint,
	worldView,
} from './support'

const openCanvas = async (page: import('@playwright/test').Page) => {
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
}

test.beforeEach(async ({ baseURL, page }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await page.emulateMedia({ reducedMotion: 'reduce' })
})

test('connector arrowhead remains a selectable hit target', async ({ page, request }) => {
	await resetBoard(request, [
		{ id: 'from', type: 'rectangle', x: 200, y: 250, w: 100, h: 80, color: '#00a2e1' },
		{ id: 'to', type: 'rectangle', x: 500, y: 250, w: 100, h: 80, color: '#00a2e1' },
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
	await openCanvas(page)
	await resetView(page)
	await page.mouse.click(493, 290)
	await expect(page.locator('[data-shape-id="edge"]')).toHaveClass(/\bsel\b/)
	await expect(page.getByRole('region', { name: 'Selected object properties' })).toBeVisible()
	await page.mouse.click(100, 500)
	await expect(page.locator('[data-shape-id="edge"]')).not.toHaveClass(/\bsel\b/)
	await page.mouse.move(493, 290)
	await page.mouse.wheel(0, -100000)
	await expect.poll(async () => (await worldView(page)).zoom).toBe(3)
	const wing = await worldPoint(page, 487, 294)
	await page.mouse.click(wing.x, wing.y)
	await expect(page.locator('[data-shape-id="edge"]')).toHaveClass(/\bsel\b/)
})

test('Fit includes curved connectors outside their node bounds', async ({ page, request }) => {
	await page.setViewportSize({ width: 1280, height: 720 })
	await resetBoard(request, [
		{ id: 'from', type: 'rectangle', x: 0, y: 0, w: 200, h: 80, color: '#00a2e1' },
		{ id: 'to', type: 'rectangle', x: 1000, y: 0, w: 200, h: 80, color: '#00a2e1' },
		{
			id: 'edge',
			type: 'connector',
			from: 'from',
			to: 'to',
			fromAnchor: 0,
			toAnchor: 0,
			color: '#00a2e1',
		},
	])
	await openCanvas(page)
	await page.getByRole('button', { name: 'Fit board', exact: true }).click()
	const line = page.locator('[data-shape-id="edge"] .connector-line')
	await expect(line).toBeVisible()
	const box = await line.boundingBox()
	if (!box) throw new Error('Missing connector geometry')
	expect(box.y).toBeGreaterThanOrEqual(0)
	expect(box.y + box.height).toBeLessThanOrEqual(720)
	const arrow = await page.locator('[data-shape-id="edge"] .e-head').boundingBox()
	if (!arrow) throw new Error('Missing connector arrow')
	expect(arrow.y).toBeGreaterThanOrEqual(0)
	expect(arrow.y + arrow.height).toBeLessThanOrEqual(720)
})

test('saved multiline and wrapped text remain visible within their original bounds', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		{
			id: 'multiline',
			type: 'text',
			x: 200,
			y: 180,
			w: 220,
			h: 138,
			color: '#2b3038',
			font: 'mono',
			fontSize: 20,
			fontWeight: 400,
			text: 'one\ntwo\nthree\nfour\nfive\nsix',
		},
		{
			id: 'wrapped',
			type: 'text',
			x: 500,
			y: 180,
			w: 120,
			h: 92,
			color: '#2b3038',
			font: 'mono',
			fontSize: 20,
			fontWeight: 400,
			text: 'aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa',
		},
	])
	await openCanvas(page)
	for (const id of ['multiline', 'wrapped']) {
		const text = page.locator(`[data-shape-id="${id}"] .canvas-text`)
		await expect(text).toBeVisible()
		const dimensions = await text.evaluate((element) => ({
			visible: element.clientHeight,
			content: element.scrollHeight,
		}))
		expect(dimensions.content, `${id} must not clip old content`).toBeLessThanOrEqual(
			dimensions.visible,
		)
	}
})

test('HTML card preserves content and interactions at its corners', async ({ page, request }) => {
	await resetBoard(request, [
		{
			id: 'corner-card',
			type: 'html',
			x: 200,
			y: 200,
			w: 300,
			h: 200,
			color: '#00a2e1',
			title: 'Card',
			html: '<html><body style="margin:0"><button id="corner" style="position:absolute;left:0;top:0;width:16px;height:16px;border:0;padding:0;background:#ff0000" onclick="this.dataset.clicked=\'yes\'"></button></body></html>',
		},
	])
	await openCanvas(page)
	await resetView(page)
	const label = page.locator('[data-card-handle="corner-card"] .card-pill')
	const labelBox = await label.boundingBox()
	if (!labelBox) throw new Error('Missing card label')
	await page.mouse.click(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2)
	const card = page.locator('[data-shape-id="corner-card"] .html-card')
	await expect(card).toHaveCSS('overflow', 'visible')
	await expect(card.locator('iframe')).toHaveCSS('border-radius', '0px')
	const corner = page.frameLocator('[data-shape-id="corner-card"] iframe').locator('#corner')
	await expect(corner).toBeVisible()
	await corner.click({ position: { x: 4, y: 4 } })
	await expect(corner).toHaveAttribute('data-clicked', 'yes')
	const screenshot = await page.screenshot({ clip: { x: 200, y: 200, width: 16, height: 16 } })
	const pixel = await page.evaluate(async (data) => {
		const image = await createImageBitmap(
			await (await fetch(`data:image/png;base64,${data}`)).blob(),
		)
		const canvas = document.createElement('canvas')
		canvas.width = canvas.height = 16
		const context = canvas.getContext('2d')
		if (!context) throw new Error('Canvas context unavailable')
		context.drawImage(image, 0, 0)
		image.close()
		return [...context.getImageData(3, 3, 1, 1).data]
	}, screenshot.toString('base64'))
	expect(pixel[0]).toBeGreaterThan(240)
	expect(pixel[1]).toBeLessThan(10)
	expect(pixel[2]).toBeLessThan(10)
})

test('an unselected HTML card selects first and then delivers iframe clicks', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		{
			id: 'interactive-card',
			type: 'html',
			x: 200,
			y: 200,
			w: 300,
			h: 200,
			color: '#00a2e1',
			title: 'Card',
			html: '<button id="target" onclick="this.dataset.clicked=\'yes\'">Activate</button>',
		},
	])
	await openCanvas(page)
	await resetView(page)
	const target = page.frameLocator('[data-shape-id="interactive-card"] iframe').locator('#target')
	const box = await target.boundingBox()
	if (!box) throw new Error('Missing HTML button')
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
	await expect(page.getByLabel('Card title')).toHaveValue('Card')
	await expect(target).not.toHaveAttribute('data-clicked', 'yes')
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	)
	await target.click()
	await expect(target).toHaveAttribute('data-clicked', 'yes')
})

test('HTML card color updates its visible label', async ({ page, request }) => {
	await resetBoard(request, [
		{
			id: 'card',
			type: 'html',
			x: 200,
			y: 200,
			w: 520,
			h: 360,
			color: '#00a2e1',
			title: 'Card',
			html: '',
		},
	])
	await openCanvas(page)
	await resetView(page)
	const label = page.locator('[data-card-handle="card"] .card-pill')
	const before = await label.evaluate((element) => getComputedStyle(element).color)
	const box = await label.boundingBox()
	if (!box) throw new Error('Missing card label')
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
	await page.getByRole('button', { name: 'Set color Green', exact: true }).click()
	await expect
		.poll(
			async () =>
				(await (await request.get('/api/board')).json()).shapes.find(
					(shape: { id: string }) => shape.id === 'card',
				)?.color,
		)
		.toBe('#a6d94f')
	await expect
		.poll(() => label.evaluate((element) => getComputedStyle(element).color))
		.not.toBe(before)
})

test('custom black and white strokes remain distinct', async ({ page, request }) => {
	await resetBoard(request, [
		{
			id: 'black',
			type: 'path',
			x: 200,
			y: 200,
			w: 100,
			h: 10,
			color: '#000000',
			brush: 'pencil',
			strokeWidth: 4,
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 10 },
			],
		},
		{
			id: 'white',
			type: 'path',
			x: 200,
			y: 300,
			w: 100,
			h: 10,
			color: '#ffffff',
			brush: 'pencil',
			strokeWidth: 4,
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 10 },
			],
		},
	])
	await openCanvas(page)
	const black = await page
		.locator('[data-shape-id="black"] path')
		.evaluate((element) => getComputedStyle(element).stroke)
	const white = await page
		.locator('[data-shape-id="white"] path')
		.evaluate((element) => getComputedStyle(element).stroke)
	expect(black).not.toBe(white)
})
