import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import type { Board, CanvasShape, Shape } from '../../src/shared/types'
import { CANDY_COLORS, CANDY_TINTS } from '../../src/web/design'
import {
	board,
	choose,
	clickPathInk,
	clickWorld,
	dragWorld,
	ISOLATED_ORIGIN,
	pillBox,
	resetBoard,
	resetView,
	shapeOf,
	worldPoint,
	worldScale,
	worldView,
} from './support'

const frame = (id: string, x: number, y: number, w: number, h: number): CanvasShape => ({
	id,
	type: 'frame',
	x,
	y,
	w,
	h,
	color: '#3b82f6',
	title: id,
})

const rect = (id: string, x: number, y: number, w: number, h: number): CanvasShape => ({
	id,
	type: 'rectangle',
	x,
	y,
	w,
	h,
	color: '#5b5fc7',
	text: id,
})

const countOf = async (request: APIRequestContext, type: Shape['type']) =>
	(await board(request)).shapes.filter((shape) => shape.type === type).length

async function seed(page: Page, request: APIRequestContext, shapes: Shape[]): Promise<Board> {
	const next = await resetBoard(request, shapes)
	await expect(page.locator('.canvas-shape')).toHaveCount(shapes.length)
	await resetView(page)
	return next
}

test.beforeEach(async ({ page, request, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await resetView(page)
})

test('rectangle, ellipse and line tools draw by dragging', async ({ page, request }) => {
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await dragWorld(page, { x: 160, y: 160 }, { x: 340, y: 260 })
	await expect.poll(async () => countOf(request, 'rectangle')).toBe(1)
	const rectangle = (await board(request)).shapes.find((shape) => shape.type === 'rectangle')
	expect(rectangle).toMatchObject({ x: 160, y: 160, w: 180, h: 100, color: CANDY_COLORS.blue })

	await page.getByRole('button', { name: 'Ellipse', exact: true }).click()
	await dragWorld(page, { x: 420, y: 160 }, { x: 560, y: 280 })
	await expect.poll(async () => countOf(request, 'ellipse')).toBe(1)
	expect((await board(request)).shapes.find((shape) => shape.type === 'ellipse')).toMatchObject({
		x: 420,
		y: 160,
		w: 140,
		h: 120,
		color: CANDY_COLORS.blue,
	})

	await page.getByRole('button', { name: 'Line', exact: true }).click()
	await dragWorld(page, { x: 160, y: 340 }, { x: 360, y: 400 })
	await expect.poll(async () => countOf(request, 'line')).toBe(1)
	expect((await board(request)).shapes.find((shape) => shape.type === 'line')).toMatchObject({
		x: 160,
		y: 340,
		w: 200,
		h: 60,
		color: CANDY_COLORS.green,
	})
})

test('text, sticky note and html tools create their primitives on click', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: 'Text', exact: true }).click()
	await clickWorld(page, 300, 200)
	await expect.poll(async () => countOf(request, 'text')).toBe(1)
	expect((await board(request)).shapes.find((shape) => shape.type === 'text')).toMatchObject({
		text: 'Type something',
		color: CANDY_COLORS.blue,
		font: 'sans',
		fontSize: 32,
		fontWeight: 500,
	})

	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await clickWorld(page, 700, 200)
	await expect.poll(async () => countOf(request, 'note')).toBe(1)
	expect((await board(request)).shapes.find((shape) => shape.type === 'note')).toMatchObject({
		text: 'Note',
		color: CANDY_TINTS.yellow,
	})

	await page.getByRole('button', { name: 'HTML card', exact: true }).click()
	await clickWorld(page, 1100, 300)
	await expect.poll(async () => countOf(request, 'html')).toBe(1)
	const html = (await board(request)).shapes.find((shape) => shape.type === 'html')
	expect(html).toMatchObject({ title: 'HTML card', html: '', w: 520, h: 360 })
	await expect(page.locator('.html-card-empty')).toHaveCount(1)
	await expect(page.getByLabel('Card title')).toHaveValue('HTML card')
})

test('sticky palette, brush style and brush width apply to new objects', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await page.getByRole('button', { name: 'Neutral sticky' }).click()
	await clickWorld(page, 500, 220)
	await expect.poll(async () => countOf(request, 'note')).toBe(1)
	expect((await board(request)).shapes.find((shape) => shape.type === 'note')).toMatchObject({
		color: CANDY_TINTS.neutral,
	})

	await page.getByRole('button', { name: 'Brush', exact: true }).click()
	await page.getByRole('button', { name: 'Brush style Pencil' }).click()
	await page.getByRole('button', { name: 'Brush width 2px' }).click()
	await dragWorld(page, { x: 200, y: 420 }, { x: 320, y: 480 })
	await expect.poll(async () => countOf(request, 'path')).toBe(1)
	expect((await board(request)).shapes.find((shape) => shape.type === 'path')).toMatchObject({
		brush: 'pencil',
		strokeWidth: 2,
	})
})

test('keyboard shortcuts switch tools and control delete, zoom and fit', async ({
	page,
	request,
}) => {
	const center = await worldPoint(page, 300, 250)
	await page.mouse.click(center.x, center.y)

	const tools: [string, string][] = [
		['v', 'Select'],
		['h', 'Pan'],
		['r', 'Rectangle'],
		['o', 'Ellipse'],
		['t', 'Text'],
		['l', 'Line'],
		['p', 'Brush'],
		['n', 'Sticky note'],
		['w', 'HTML card'],
		['c', 'Connector'],
	]
	for (const [key, label] of tools) {
		await page.keyboard.press(key)
		await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute(
			'aria-pressed',
			'true',
		)
	}
	await page.keyboard.press('Escape')
	await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	)

	await resetView(page)
	const panStart = await worldPoint(page, 600, 500)
	const panEnd = await worldPoint(page, 700, 560)
	await page.keyboard.down('Space')
	await page.waitForTimeout(50)
	await page.mouse.move(panStart.x, panStart.y)
	await page.mouse.down()
	await page.mouse.move(panEnd.x, panEnd.y, { steps: 6 })
	await page.mouse.up()
	await page.keyboard.up('Space')
	await expect.poll(async () => (await worldView(page)).x).toBeCloseTo(100, 5)
	await expect.poll(async () => (await worldView(page)).y).toBeCloseTo(60, 5)
	await expect.poll(async () => worldScale(page)).toBe(1)
	await resetView(page)

	const note: CanvasShape = {
		id: 'kb-note',
		type: 'note',
		x: 400,
		y: 300,
		w: 160,
		h: 160,
		color: CANDY_TINTS.yellow,
		text: 'Editor focus',
	}
	await seed(page, request, [note])
	const noteCenter = await worldPoint(page, note.x + note.w / 2, note.y + note.h / 2)
	await page.mouse.dblclick(noteCenter.x, noteCenter.y)
	const editor = page.locator('.inline-editor textarea')
	await expect(editor).toBeVisible()
	await page.keyboard.press('r')
	await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await expect(editor).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(editor).toHaveCount(0)

	await seed(page, request, [rect('kb-rect', 200, 200, 200, 100)])
	await clickWorld(page, 300, 250)
	await page.keyboard.press('Delete')
	await expect.poll(async () => (await board(request)).shapes.length).toBe(0)

	await resetView(page)
	const initial = await worldView(page)
	expect(initial).toEqual({ x: 0, y: 0, zoom: 1 })
	await page.keyboard.press('=')
	await expect.poll(async () => worldScale(page)).toBeCloseTo(1.2, 5)
	await page.keyboard.press('=')
	await expect.poll(async () => worldScale(page)).toBeCloseTo(1.44, 5)
	await page.keyboard.press('0')
	await expect.poll(async () => worldView(page)).toEqual({ x: 0, y: 0, zoom: 1 })
	await page.keyboard.press('-')
	await expect.poll(async () => worldScale(page)).toBeCloseTo(1 / 1.2, 5)
	await page.keyboard.press('0')
	await expect.poll(async () => worldScale(page)).toBe(1)

	await seed(page, request, [
		rect('kb-near', 80, 160, 160, 80),
		rect('kb-far', 2800, 400, 200, 100),
	])
	const farBefore = await page.locator('[data-shape-id="kb-far"] > rect').first().boundingBox()
	if (!farBefore) throw new Error('Expected the far rectangle')
	expect(farBefore.x).toBeGreaterThan(1440)
	await page.keyboard.press('f')
	await expect.poll(async () => worldScale(page)).toBeLessThan(1)
	for (const id of ['kb-near', 'kb-far']) {
		const box = await page.locator(`[data-shape-id="${id}"] > rect`).first().boundingBox()
		if (!box) throw new Error(`Missing ${id}`)
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.y).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(1440)
		expect(box.y + box.height).toBeLessThanOrEqual(960)
	}
})

test('modifier clicks add and remove objects from the selection', async ({ page, request }) => {
	await seed(page, request, [
		rect('pick-a', 200, 200, 160, 100),
		rect('pick-b', 500, 200, 160, 100),
	])
	const first = await worldPoint(page, 280, 250)
	const second = await worldPoint(page, 580, 250)
	await page.mouse.click(first.x, first.y)
	await expect(page.locator('.selection')).toHaveCount(1)
	await page.keyboard.down('Meta')
	await page.mouse.click(second.x, second.y)
	await page.keyboard.up('Meta')
	await expect(page.locator('.selection')).toHaveCount(2)
	await page.keyboard.down('Meta')
	await page.mouse.click(second.x, second.y)
	await page.keyboard.up('Meta')
	await expect(page.locator('.selection')).toHaveCount(1)
	await page.keyboard.down('Shift')
	await page.mouse.click(second.x, second.y)
	await page.keyboard.up('Shift')
	await expect(page.locator('.selection')).toHaveCount(2)
})

test('tiny drags and Escape never create partial shapes', async ({ page, request }) => {
	const writes: string[] = []
	page.on('request', (requestEvent) => {
		if (requestEvent.method() === 'POST' && requestEvent.url().includes('/api/operations'))
			writes.push(requestEvent.url())
	})
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	const start = await worldPoint(page, 400, 300)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(start.x + 4, start.y + 3)
	await page.mouse.up()
	await page.waitForTimeout(150)
	expect(writes).toHaveLength(0)
	expect((await board(request)).shapes).toHaveLength(0)

	const from = await worldPoint(page, 200, 200)
	const to = await worldPoint(page, 320, 280)
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(to.x, to.y, { steps: 4 })
	await page.keyboard.press('Escape')
	await page.mouse.up()
	await page.waitForTimeout(150)
	expect(writes).toHaveLength(0)
	expect((await board(request)).shapes).toHaveLength(0)
	await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
})

test('properties panel edits text, colors, path brushes and typography', async ({
	page,
	request,
}) => {
	const path: CanvasShape = {
		id: 'panel-path',
		type: 'path',
		x: 600,
		y: 300,
		w: 120,
		h: 80,
		color: '#263248',
		brush: 'brush',
		strokeWidth: 4,
		points: [
			{ x: 0, y: 0 },
			{ x: 60, y: 80 },
			{ x: 120, y: 0 },
		],
	}
	const text: CanvasShape = {
		id: 'panel-text',
		type: 'text',
		x: 600,
		y: 440,
		w: 320,
		h: 48,
		color: '#1d4ed8',
		text: 'Heading',
		font: 'sans',
		fontSize: 32,
		fontWeight: 500,
	}
	await seed(page, request, [rect('panel-rect', 160, 160, 220, 120), path, text])

	const properties = page.getByRole('region', { name: 'Selected object properties' })
	await clickWorld(page, 270, 220)
	await expect(properties).toBeVisible()
	await properties.getByLabel('Text', { exact: true }).fill('Panel rename')
	await properties.getByLabel('Text', { exact: true }).press('Enter')
	await expect.poll(async () => (await shapeOf(request, 'panel-rect')).text).toBe('Panel rename')
	await properties.getByRole('button', { name: 'Set color Green' }).click()
	await expect
		.poll(async () => (await shapeOf(request, 'panel-rect')).color)
		.toBe(CANDY_COLORS.green)

	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await clickPathInk(page, 'panel-path')
	await expect(properties).toBeVisible()
	await choose(page, 'Brush style', 'Marker')
	await choose(page, 'Stroke width', '8px')
	await expect.poll(async () => (await shapeOf(request, 'panel-path')).brush).toBe('marker')
	await expect.poll(async () => (await shapeOf(request, 'panel-path')).strokeWidth).toBe(8)

	await expect(page.getByRole('option')).toHaveCount(0)
	await page.locator('[data-shape-id="panel-text"] > rect').first().click()
	await expect(properties).toBeVisible()
	await properties.getByLabel('Text', { exact: true }).fill('Edited heading')
	await properties.getByLabel('Text', { exact: true }).press('Control+Enter')
	await choose(page, 'Font family', 'Serif')
	await choose(page, 'Font size', '24')
	await choose(page, 'Font weight', '400')
	await expect
		.poll(async () => {
			const shape = await shapeOf(request, 'panel-text')
			return {
				text: shape.text,
				font: shape.font,
				fontSize: shape.fontSize,
				fontWeight: shape.fontWeight,
			}
		})
		.toEqual({ text: 'Edited heading', font: 'serif', fontSize: 24, fontWeight: 400 })
})

test('frame and html titles save from the properties panel', async ({ page, request }) => {
	await seed(page, request, [
		frame('title-frame', 200, 200, 640, 400),
		{
			id: 'title-html',
			type: 'html',
			x: 240,
			y: 280,
			w: 520,
			h: 260,
			color: '#22c55e',
			title: 'Original card',
			html: '<p>content</p>',
			frameId: 'title-frame',
		},
	])

	const labelBox = await pillBox(page, 'title-frame')
	await page.mouse.click(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2)
	const properties = page.getByRole('region', { name: 'Selected object properties' })
	await expect(properties).toBeVisible()
	await properties.getByLabel('Frame title').fill('Renamed frame')
	await properties.getByLabel('Frame title').press('Enter')
	await expect.poll(async () => (await shapeOf(request, 'title-frame')).title).toBe('Renamed frame')

	const htmlPoint = await worldPoint(page, 500, 410)
	await page.mouse.click(htmlPoint.x, htmlPoint.y)
	await expect(properties.getByLabel('Card title')).toHaveValue('Original card')
	await properties.getByLabel('Card title').fill('Renamed card')
	await properties.getByLabel('Card title').press('Enter')
	await expect.poll(async () => (await shapeOf(request, 'title-html')).title).toBe('Renamed card')
	expect((await shapeOf(request, 'title-html')).html).toBe('<p>content</p>')
})

test('frame membership accepts lines, strokes and html cards but never html as host', async ({
	page,
	request,
}) => {
	await seed(page, request, [
		frame('membership-a', 100, 100, 700, 500),
		frame('membership-b', 900, 100, 400, 300),
	])

	await page.getByRole('button', { name: 'Line', exact: true }).click()
	await dragWorld(page, { x: 200, y: 200 }, { x: 500, y: 260 })
	await expect.poll(async () => countOf(request, 'line')).toBe(1)
	const line = (await board(request)).shapes.find((shape) => shape.type === 'line') as CanvasShape
	await expect.poll(async () => (await shapeOf(request, line.id)).frameId).toBe('membership-a')

	await page.getByRole('button', { name: 'Brush', exact: true }).click()
	await dragWorld(page, { x: 220, y: 320 }, { x: 480, y: 360 })
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((item) => item.type === 'path')
			return shape?.type === 'path' ? shape.frameId : 'missing'
		})
		.toBe('membership-a')

	await page.getByRole('button', { name: 'HTML card', exact: true }).click()
	await clickWorld(page, 500, 350)
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((item) => item.type === 'html')
			return shape?.type === 'html' ? shape.frameId : 'missing'
		})
		.toBe('membership-a')

	const html = (await board(request)).shapes.find((item) => item.type === 'html') as CanvasShape
	const rejectedHost = await request.post('/api/operations', {
		data: {
			operations: [
				{
					type: 'create',
					shape: {
						id: 'inside-html',
						type: 'note',
						x: html.x + 20,
						y: html.y + 20,
						w: 80,
						h: 80,
						color: CANDY_TINTS.yellow,
						text: 'Nope',
						frameId: html.id,
					},
				},
			],
		},
	})
	expect(rejectedHost.status()).toBe(400)

	const current = await board(request)
	const dropped = await request.post('/api/operations', {
		data: {
			expectedRevision: current.revision,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'drop-note',
						type: 'note',
						x: 1100,
						y: 620,
						w: 160,
						h: 160,
						color: CANDY_TINTS.yellow,
						text: 'Drop target',
					},
				},
			],
		},
	})
	expect(dropped.ok()).toBe(true)
	await expect(page.locator('[data-shape-id="drop-note"]')).toHaveCount(1)
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	const dropFrom = await worldPoint(page, 1180, 700)
	const dropTo = await worldPoint(page, html.x + html.w / 2, html.y + html.h / 2)
	await page.mouse.move(dropFrom.x, dropFrom.y)
	await page.mouse.down()
	await page.mouse.move(dropTo.x, dropTo.y, { steps: 10 })
	await page.mouse.up()
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((item) => item.id === 'drop-note')
			return shape?.type === 'note' ? shape.frameId : 'missing'
		})
		.toBe('membership-a')

	const htmlHandle = await worldPoint(page, html.x + html.w - 60, html.y + 60)
	const outside = await worldPoint(page, 1350, 700)
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.mouse.move(htmlHandle.x, htmlHandle.y)
	await page.mouse.down()
	await page.mouse.move(outside.x, outside.y, { steps: 10 })
	await page.mouse.up()
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((item) => item.id === html.id)
			return shape?.type === 'html' ? shape.frameId : 'missing'
		})
		.toBeUndefined()
})

test('zoom buttons, reset and fit keep objects reachable', async ({ page, request }) => {
	await seed(page, request, [
		rect('zoom-near', 80, 160, 160, 80),
		rect('zoom-far', 2600, 700, 160, 80),
	])

	await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
	await expect.poll(async () => worldScale(page)).toBeCloseTo(1.2, 5)
	await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
	await expect.poll(async () => worldScale(page)).toBeCloseTo(1, 5)
	await page.getByRole('button', { name: 'Reset view' }).click()
	await expect.poll(async () => worldScale(page)).toBe(1)

	await page.getByRole('button', { name: 'Fit board', exact: true }).click()
	await expect.poll(async () => worldScale(page)).toBeLessThan(1)
	for (const id of ['zoom-near', 'zoom-far']) {
		const box = await page.locator(`[data-shape-id="${id}"] > rect`).first().boundingBox()
		if (!box) throw new Error(`Missing ${id}`)
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.y).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(1440)
		expect(box.y + box.height).toBeLessThanOrEqual(960)
	}
})

test('identity, dock and properties panels share one surface style', async ({ page, request }) => {
	await seed(page, request, [rect('surface-rect', 200, 200, 200, 100)])
	await clickWorld(page, 300, 250)
	await expect(page.getByRole('region', { name: 'Selected object properties' })).toBeVisible()

	const panelStyles = await page.evaluate(() => {
		const read = (selector: string) => {
			const element = document.querySelector(selector)
			if (!element) throw new Error(`Missing panel ${selector}`)
			const style = getComputedStyle(element)
			return {
				background: style.backgroundColor,
				radius: style.borderRadius,
				shadow: style.boxShadow,
				border: `${style.borderTopWidth} ${style.borderTopColor}`,
			}
		}
		return {
			identity: read('.identity-panel'),
			dock: read('.toolbar'),
			properties: read('.selection-panel'),
		}
	})

	for (const panel of Object.values(panelStyles)) {
		expect(panel.background).toBe('rgb(255, 255, 255)')
		expect(panel.radius).toBe('20px')
		expect(panel.shadow).not.toBe('none')
	}
	expect(panelStyles.identity).toEqual(panelStyles.dock)
	expect(panelStyles.dock).toEqual(panelStyles.properties)

	const idleToolBackgrounds = await page
		.locator('.drawing-tools .icon-button:not([aria-pressed="true"])')
		.evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).backgroundColor))
	expect(idleToolBackgrounds.length).toBeGreaterThan(0)
	for (const background of idleToolBackgrounds) expect(background).toBe('rgba(0, 0, 0, 0)')
})
