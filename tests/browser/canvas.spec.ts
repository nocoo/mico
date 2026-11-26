import { type APIRequestContext, expect, type Page } from '@playwright/test'
import type { Board, CanvasShape, Connector } from '../../src/shared/types'
import { CANDY_TINTS } from '../../src/web/design'
import { closeAssistant, isIsolatedOrigin, test } from './support'

async function board(request: APIRequestContext): Promise<Board> {
	const response = await request.get('/api/board')
	expect(response.ok()).toBe(true)
	return response.json()
}

async function choose(page: Page, label: string, option: string) {
	await page.getByRole('combobox', { name: label, exact: true }).click()
	await page.getByRole('option', { name: option, exact: true }).click()
}

async function worldPoint(page: Page, x: number, y: number) {
	const view = await page.locator('[data-world-layer]').evaluate((element) => {
		const matrix = (element as SVGGElement).transform.baseVal.consolidate()?.matrix
		if (!matrix) throw new Error('Missing world transform')
		return { x: matrix.e, y: matrix.f, zoom: matrix.a }
	})
	return { x: view.x + x * view.zoom, y: view.y + y * view.zoom }
}

async function targetPoint(page: Page, id: string, side: 'left' | 'right' = 'left') {
	const box = await page.locator(`[data-shape-id="${id}"] > rect`).first().boundingBox()
	if (!box) throw new Error(`Missing node: ${id}`)
	return { x: side === 'left' ? box.x - 12 : box.x + box.width - 1, y: box.y + box.height / 2 }
}

test.beforeEach(async ({ request, page, baseURL }) => {
	if (!isIsolatedOrigin(baseURL)) throw new Error('Refusing to mutate a non-isolated canvas')
	const current = await board(request)
	const nodes: CanvasShape[] = [
		{
			id: 'a',
			type: 'rectangle',
			x: 160,
			y: 200,
			w: 200,
			h: 80,
			color: '#5b5fc7',
			text: 'API gateway',
		},
		{
			id: 'b',
			type: 'rectangle',
			x: 700,
			y: 200,
			w: 200,
			h: 80,
			color: '#0f6cbd',
			text: 'Order service',
		},
		{
			id: 'c',
			type: 'rectangle',
			x: 700,
			y: 540,
			w: 200,
			h: 80,
			color: '#107c10',
			text: 'Event worker',
		},
		{
			id: 'd',
			type: 'rectangle',
			x: 160,
			y: 540,
			w: 200,
			h: 80,
			color: '#b45309',
			text: 'Identity service',
		},
	]
	const response = await request.post('/api/operations', {
		data: {
			expectedRevision: current.revision,
			operations: [
				...current.shapes.map((shape) => ({ type: 'delete', id: shape.id })),
				...nodes.map((shape) => ({ type: 'create', shape })),
				{
					type: 'create',
					shape: {
						id: 'edge',
						type: 'connector',
						from: 'a',
						to: 'b',
						fromAnchor: 3,
						toAnchor: 2,
						color: '#5c6474',
					},
				},
			],
		},
	})
	expect(response.ok()).toBe(true)
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await expect(page.locator('.canvas-shape')).toHaveCount(5)
})

test('marquee selects several objects and deletes them atomically', async ({ page, request }) => {
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.mouse.move(120, 160)
	await page.mouse.down()
	await page.mouse.move(960, 310, { steps: 10 })
	await expect(page.locator('.marquee')).toHaveCount(1)
	await page.mouse.up()
	await expect(page.locator('.marquee')).toHaveCount(0)
	await expect(page.locator('[data-shape-id] .selection')).toHaveCount(2)
	const before = await board(request)
	await page.keyboard.press('Delete')
	await expect.poll(async () => (await board(request)).shapes.length).toBe(2)
	expect(before.shapes.length).toBe(5)
	const remaining = (await board(request)).shapes.map((shape) => shape.id)
	expect(remaining).toContain('c')
	expect(remaining).toContain('d')
	expect(remaining).not.toContain('a')
	expect(remaining).not.toContain('b')
})

test('sticky note text edits inline and in the properties panel', async ({ page, request }) => {
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await page.getByRole('button', { name: 'Pink sticky' }).click()
	await page.mouse.click(500, 400)
	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'note'))
		.toBe(true)
	const note = (await board(request)).shapes.find((shape) => shape.type === 'note') as
		| CanvasShape
		| undefined
	if (note?.type !== 'note') throw new Error('Expected a note')
	expect(note).toMatchObject({ color: CANDY_TINTS.pink, text: 'Note' })
	await expect(page.locator(`[data-shape-id="${note.id}"]`).first()).toBeVisible()

	const center = await worldPoint(page, note.x + note.w / 2, note.y + note.h / 2)
	await page.mouse.dblclick(center.x, center.y)
	const editor = page.locator('.inline-editor textarea')
	await expect(editor).toBeVisible()
	const editorBox = await editor.boundingBox()
	if (!editorBox) throw new Error('Expected the inline editor')
	await page.mouse.move(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2)
	await page.mouse.down()
	await expect(page.locator('.marquee')).toHaveCount(0)
	await page.mouse.up()
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type('Inline remember')
	await page.keyboard.press('Control+Enter')
	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.id === note.id))
		.toMatchObject({ text: 'Inline remember' })

	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.mouse.click(center.x, center.y)
	await expect(page.getByRole('region', { name: 'Selected object properties' })).toBeVisible()
	await page.locator('#shape-text').fill('Panel remember')
	await page.locator('#shape-text').press('Control+Enter')
	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.id === note.id))
		.toMatchObject({ text: 'Panel remember' })
})

test('freehand brush draws a persisted tapered path and API sketches render', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: 'Brush', exact: true }).click()
	await expect(page.getByRole('group', { name: 'Brush options' })).toBeVisible()
	await page.getByRole('button', { name: 'Brush style Brush' }).click()
	await page.getByRole('button', { name: 'Brush width 8px' }).click()
	await page.mouse.move(320, 700)
	await page.mouse.down()
	for (const [x, y] of [
		[340, 660],
		[380, 640],
		[420, 665],
		[460, 700],
		[500, 680],
	]) {
		await page.mouse.move(x, y, { steps: 4 })
	}
	await page.mouse.up()
	await expect
		.poll(async () => (await board(request)).shapes.filter((shape) => shape.type === 'path').length)
		.toBe(1)
	const path = (await board(request)).shapes.find((shape) => shape.type === 'path')
	expect(path).toMatchObject({ type: 'path', brush: 'brush', strokeWidth: 8 })
	if (path?.type !== 'path') throw new Error('Expected a path shape')
	expect(path.points?.length ?? 0).toBeGreaterThan(3)
	for (const point of path.points ?? []) {
		expect(point.x).toBeGreaterThanOrEqual(0)
		expect(point.x).toBeLessThanOrEqual(path.w)
		expect(point.y).toBeGreaterThanOrEqual(0)
		expect(point.y).toBeLessThanOrEqual(path.h)
	}
	await page.reload()
	await closeAssistant(page)
	await expect(page.locator(`[data-shape-id="${path.id}"] path`)).not.toHaveCount(0)

	await page.getByRole('button', { name: 'Select', exact: true }).click()
	const ink = await page
		.locator(`[data-shape-id="${path.id}"] path`)
		.first()
		.evaluate((element) => {
			const shape = element as SVGPathElement
			const point = shape.getPointAtLength(shape.getTotalLength() / 2)
			const screen = new DOMPoint(point.x, point.y).matrixTransform(
				shape.getScreenCTM() ?? undefined,
			)
			return { x: screen.x, y: screen.y }
		})
	await page.mouse.click(ink.x, ink.y)
	await expect(page.getByRole('region', { name: 'Selected object properties' })).toBeVisible()
	await choose(page, 'Stroke width', '2px')
	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.id === path.id))
		.toMatchObject({ strokeWidth: 2 })

	const revision = (await board(request)).revision
	const apiPath = await request.post('/api/operations', {
		data: {
			expectedRevision: revision,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'api-figure',
						type: 'path',
						x: 900,
						y: 200,
						w: 120,
						h: 80,
						color: '#242424',
						brush: 'marker',
						strokeWidth: 4,
						points: [
							{ x: 0, y: 0 },
							{ x: 60, y: 80 },
							{ x: 120, y: 0 },
						],
					},
				},
			],
		},
	})
	expect(apiPath.ok()).toBe(true)
	await expect(page.locator('[data-shape-id="api-figure"] path')).toHaveCount(1)
})

test('drag creates a connector with exactly the highlighted target anchor', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: 'Connector', exact: true }).click()
	const start = await targetPoint(page, 'a', 'right')
	const end = await targetPoint(page, 'c')
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps: 8 })
	const active = page.locator('[data-snap-target="c"] .snap-anchor.is-active')
	const anchorIndex = Number(await active.getAttribute('data-anchor-index'))
	await page.mouse.up()
	await expect.poll(async () => (await board(request)).shapes.length).toBe(6)
	const created = (await board(request)).shapes.find(
		(shape): shape is Connector => shape.type === 'connector' && shape.id !== 'edge',
	)
	expect(created).toMatchObject({ from: 'a', to: 'c', fromAnchor: 3, toAnchor: anchorIndex })
	await page.reload()
	await closeAssistant(page)
	await expect(page.locator('.canvas-shape')).toHaveCount(6)
})
