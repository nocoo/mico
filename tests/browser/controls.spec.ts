import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import type { Board, CanvasShape, Shape } from '../../src/shared/types'
import { JELLY_COLORS } from '../../src/web/canvas/jelly'
import { CANDY_COLORS, CANDY_TINTS } from '../../src/web/design'
import {
	board,
	choose,
	clickPathInk,
	clickWorld,
	closeAssistant,
	dragWorld,
	ISOLATED_ORIGIN,
	resetBoard,
	resetView,
	shapeOf,
	worldPoint,
	worldScale,
	worldView,
} from './support'

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
	await closeAssistant(page)
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
		color: JELLY_COLORS.peach,
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
