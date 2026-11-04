import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test'
import type { Board, CanvasShape, Connector } from '../../src/shared/types'

async function board(request: APIRequestContext): Promise<Board> {
	const response = await request.get('/api/board')
	expect(response.ok()).toBe(true)
	return response.json()
}

async function choose(page: Page, label: string, option: string) {
	await page.getByRole('combobox', { name: label, exact: true }).click()
	await page.getByRole('option', { name: option, exact: true }).click()
}

async function center(locator: Locator) {
	const box = await locator.boundingBox()
	if (!box) throw new Error('Expected a visible canvas object')
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function targetPoint(page: Page, id: string, side: 'left' | 'right' = 'left') {
	const box = await page.locator(`[data-shape-id="${id}"] > rect`).first().boundingBox()
	if (!box) throw new Error(`Missing node: ${id}`)
	return { x: side === 'left' ? box.x - 12 : box.x + box.width - 1, y: box.y + box.height / 2 }
}

async function selectEdge(page: Page) {
	const point = await page
		.locator('[data-shape-id="edge"] line')
		.last()
		.evaluate((element) => {
			const line = element as SVGLineElement
			const point = line.getPointAtLength(line.getTotalLength() / 2)
			const screen = new DOMPoint(point.x, point.y).matrixTransform(
				line.getScreenCTM() ?? undefined,
			)
			return { x: screen.x, y: screen.y }
		})
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.mouse.click(point.x, point.y)
	await expect(page.locator('[data-connection-handle]')).toHaveCount(2)
}

async function dragEndpoint(page: Page, endpoint: 'from' | 'to', target: string) {
	const start = await center(page.locator(`[data-connection-handle="${endpoint}"]`))
	const end = await targetPoint(page, target)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps: 8 })
	await expect(page.locator(`[data-snap-target="${target}"] .snap-anchor.is-active`)).toHaveCount(1)
	return end
}

async function edge(request: APIRequestContext): Promise<Connector | undefined> {
	return (await board(request)).shapes.find(
		(shape): shape is Connector => shape.type === 'connector' && shape.id === 'edge',
	)
}

test.beforeEach(async ({ request, page, baseURL }) => {
	if (baseURL !== 'http://127.0.0.1:27063')
		throw new Error('Refusing to mutate a non-isolated canvas')
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
	await expect(page.locator('.canvas-shape')).toHaveCount(5)
})

test('frame uses real icons, hover-only shortcuts and keyboard toolbar navigation', async ({
	page,
}) => {
	const toolbar = page.getByRole('toolbar', { name: 'Canvas tools' })
	await expect(page.locator('.identity-panel')).toHaveText('mico')
	await expect(page.locator('.status-dot')).toHaveCSS('animation-name', 'status-breathe')
	await expect(toolbar.locator('button > svg.lucide')).toHaveCount(15)
	await expect(page.getByRole('button', { name: 'Interface settings' })).toHaveCount(0)
	await expect(page.locator('.topbar .view-controls')).toHaveCount(0)
	await expect(toolbar.getByRole('group', { name: 'View controls', exact: true })).toBeVisible()
	const select = page.getByRole('button', { name: 'Select', exact: true })
	await expect(page.getByRole('tooltip')).toHaveCount(0)
	await select.hover()
	const tooltip = page.getByRole('tooltip')
	await expect(tooltip).toContainText('Select')
	await expect(tooltip.locator('kbd')).toHaveText('V')
	await select.focus()
	await page.keyboard.press('ArrowRight')
	await expect(page.getByRole('button', { name: 'Pan', exact: true })).toBeFocused()
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Pan', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await page.mouse.move(0, 0)
	await page.getByRole('button', { name: 'Pan', exact: true }).evaluate((element) => element.blur())
	await page.screenshot({ path: '/tmp/mico-frame-desktop.png', animations: 'disabled' })
})

test('selected object properties live inside the dock and edit the board', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.locator('[data-shape-id="a"] > rect').first().click()
	const dock = page.getByRole('toolbar')
	const dockBefore = await dock.boundingBox()
	const properties = page.getByRole('region', { name: 'Selected object properties' })
	await expect(properties).toBeVisible()
	const panel = await properties.boundingBox()
	if (!panel || !dockBefore) throw new Error('Expected properties and dock')
	expect(panel.y + panel.height).toBeLessThanOrEqual(dockBefore.y)
	expect(await dock.boundingBox()).toEqual(dockBefore)
	await page.screenshot({ path: '/tmp/mico-selection-panel.png', animations: 'disabled' })
	await properties.getByLabel('Text', { exact: true }).fill('Renamed gateway')
	await properties.getByLabel('Text', { exact: true }).press('Enter')
	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.id === 'a'))
		.toMatchObject({ text: 'Renamed gateway' })
	await properties.getByRole('button', { name: 'Set color Green' }).click()
	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.id === 'a'))
		.toMatchObject({ color: '#107c10' })
	await properties.getByRole('button', { name: 'Close properties' }).click()
	await expect(properties).toHaveCount(0)
})

test('frame controls align to four-pixel layout slots even on fractional viewport edges', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1453, height: 969 })
	const controls = await page
		.locator('.topbar .icon-button, .toolbar .icon-button, .zoom-value')
		.evaluateAll((buttons) =>
			buttons.map((button) => {
				const { x, y, width, height } = button.getBoundingClientRect()
				return { label: button.getAttribute('aria-label'), x, y, width, height }
			}),
		)
	for (const control of controls) {
		for (const dimension of [control.x, control.y, control.width, control.height]) {
			expect(
				Math.abs(dimension / 4 - Math.round(dimension / 4)),
				`${control.label} must use four-pixel-aligned geometry`,
			).toBeLessThan(0.001)
		}
	}
	const sorted = [...controls].sort((a, b) => a.x - b.x)
	for (let index = 1; index < sorted.length; index += 1) {
		const gap = sorted[index].x - (sorted[index - 1].x + sorted[index - 1].width)
		expect(gap, `${sorted[index].label} needs a visible gap`).toBeGreaterThanOrEqual(4)
		expect(Math.abs(gap / 4 - Math.round(gap / 4))).toBeLessThan(0.001)
	}
})

test('world grid follows pan and zoom while the identity and complete dock stay fixed', async ({
	page,
}) => {
	const snapshot = () =>
		page.locator('.identity-panel, .brand-mark, .toolbar').evaluateAll((elements) =>
			elements.map((element) => {
				const { x, y, width, height } = element.getBoundingClientRect()
				return { x, y, width, height }
			}),
		)
	const worldGrid = () =>
		page.locator('[data-world-layer]').evaluate((element) => {
			const matrix = (element as SVGGElement).transform.baseVal.consolidate()?.matrix
			const pattern = document.querySelector<SVGPatternElement>('.blueprint-grid pattern')
			const offset = pattern?.patternTransform.baseVal.consolidate()?.matrix
			if (!matrix || !pattern || !offset) throw new Error('Missing world or grid transform')
			return {
				zoom: matrix.a,
				x: matrix.e,
				y: matrix.f,
				tile: Number(pattern.getAttribute('width')),
				offsetX: offset.e,
				offsetY: offset.f,
			}
		})
	const verify = async (initial: Awaited<ReturnType<typeof snapshot>>) => {
		expect(await snapshot()).toEqual(initial)
		await expect(page.locator('.topbar')).toHaveCSS('position', 'fixed')
		await expect(page.locator('.toolbar')).toHaveCSS('position', 'fixed')
		for (const button of await page.getByRole('toolbar').getByRole('button').all())
			await expect(button).toBeVisible()
		const grid = await worldGrid()
		expect(grid.tile).toBeCloseTo(64 * grid.zoom)
		expect(grid.offsetX).toBeCloseTo(((grid.x % grid.tile) + grid.tile) % grid.tile)
		expect(grid.offsetY).toBeCloseTo(((grid.y % grid.tile) + grid.tile) % grid.tile)
	}

	await page.getByRole('button', { name: 'Reset view' }).click()
	const initial = await snapshot()
	await expect(page.locator('[data-grid-level="minor"]')).toHaveAttribute('stroke-dasharray', '4 4')
	await expect(page.locator('[data-grid-level="minor"]')).toHaveAttribute(
		'd',
		'M16 0V64M0 16H64M32 0V64M0 32H64M48 0V64M0 48H64',
	)
	await expect(page.locator('[data-grid-level="fine"]')).toHaveCount(0)
	await page.getByRole('button', { name: 'Pan', exact: true }).click()
	await page.mouse.move(600, 760)
	await page.mouse.down()
	await page.mouse.move(500, 700, { steps: 4 })
	await page.mouse.up()
	expect(await worldGrid()).toMatchObject({ x: -100, y: -60, offsetX: 28, offsetY: 4 })
	await verify(initial)
	await page.mouse.wheel(0, -100000)
	await expect.poll(async () => (await worldGrid()).zoom).toBe(3)
	await verify(initial)
	await page.mouse.wheel(0, 100000)
	await expect.poll(async () => (await worldGrid()).zoom).toBeCloseTo(0.05, 6)
	await verify(initial)
	await page.getByRole('button', { name: 'Reset view' }).click()
	await verify(initial)
	await page.mouse.move(0, 0)
	await page.screenshot({ path: '/tmp/mico-blueprint-fixed-dock.png', animations: 'disabled' })
})

test('dock and its property popovers stay on-screen at narrow and wide widths', async ({
	page,
}) => {
	for (const width of [360, 390, 768, 1440]) {
		await page.setViewportSize({ width, height: 844 })
		await page.getByRole('button', { name: 'Select', exact: true }).click()
		await page.locator('[data-shape-id="a"] > rect').first().click()
		const dock = page.getByRole('toolbar')
		const dockBox = await dock.boundingBox()
		if (!dockBox) throw new Error('Expected a visible dock')
		for (const button of await dock.getByRole('button').all()) {
			await expect(button).toBeVisible()
			const box = await button.boundingBox()
			if (!box) throw new Error('Expected a visible dock control')
			expect(box.x).toBeGreaterThanOrEqual(0)
			expect(box.x + box.width).toBeLessThanOrEqual(width)
			expect(box.y + box.height).toBeLessThanOrEqual(844)
		}
		const panel = await page
			.getByRole('region', { name: 'Selected object properties' })
			.boundingBox()
		if (!panel) throw new Error('Expected a visible properties panel')
		expect(panel.x).toBeGreaterThanOrEqual(0)
		expect(panel.x + panel.width).toBeLessThanOrEqual(width)
		expect(panel.y).toBeGreaterThanOrEqual(0)
		expect(panel.y + panel.height).toBeLessThanOrEqual(dockBox.y)
		await page.getByRole('button', { name: 'Close properties' }).click()
		await page.mouse.move(0, 0)
		await page.screenshot({ path: `/tmp/mico-dock-${width}.png`, animations: 'disabled' })
	}
})

test('dragging snaps to the grid and aligns with nearby objects using guides', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	const start = await center(page.locator('[data-shape-id="a"] > rect').first())
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(start.x + 3, start.y + 297, { steps: 8 })
	const guide = page.locator('.alignment-guide[data-guide-axis="x"]')
	await expect(guide).toHaveCount(1)
	const guideValue = Number(await guide.getAttribute('x1'))
	expect(guideValue).toBeCloseTo(160)
	await page.screenshot({ path: '/tmp/mico-snap-guides.png', animations: 'disabled' })
	await page.mouse.up()
	await expect(guide).toHaveCount(0)
	const moved = (await board(request)).shapes.find((shape) => shape.id === 'a')
	expect(moved).toMatchObject({ x: 160 })
	expect(moved && moved.type !== 'connector' ? moved.y : NaN).toBe(496)
})

test('marquee selects several objects and deletes them atomically', async ({ page, request }) => {
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.mouse.move(120, 160)
	await page.mouse.down()
	await page.mouse.move(960, 310, { steps: 10 })
	await expect(page.locator('.marquee')).toHaveCount(1)
	await page.screenshot({ path: '/tmp/mico-marquee.png', animations: 'disabled' })
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

test('notes, typographic text and frames are editable and move together', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await page.getByRole('button', { name: 'Pink sticky' }).click()
	await page.mouse.click(500, 400)
	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'note'))
		.toBe(true)
	const note = (await board(request)).shapes.find((shape) => shape.type === 'note') as
		| CanvasShape
		| undefined
	if (!note || note.type !== 'note') throw new Error('Expected a note')
	expect(note).toMatchObject({ color: '#fbcfe8', text: 'Note' })
	await page.locator('#shape-text').fill('Remember this')
	await page.locator('#shape-text').press('Control+Enter')
	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.id === note.id))
		.toMatchObject({ text: 'Remember this' })

	await page.getByRole('button', { name: 'Text', exact: true }).click()
	await choose(page, 'Font family', 'Hand')
	await choose(page, 'Font size', '48')
	await choose(page, 'Font weight', '700')
	await page.waitForTimeout(350)
	await page.mouse.click(1250, 500)
	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'text'))
		.toBe(true)
	const heading = (await board(request)).shapes.find((shape) => shape.type === 'text')
	expect(heading).toMatchObject({ font: 'hand', fontSize: 48, fontWeight: 700 })
	const ink = page.locator('[data-shape-id="' + heading?.id + '"] .typographic-text')
	await expect(ink).toHaveCount(1)
	await expect(
		page.locator(
			'[data-shape-id="' + heading?.id + '"] > rect:not(.selection):not([fill="transparent"])',
		),
	).toHaveCount(0)

	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.mouse.move(120, 160)
	await page.mouse.down()
	await page.mouse.move(960, 310, { steps: 6 })
	await page.mouse.up()
	await page.getByRole('button', { name: 'Frame selection' }).click()
	await expect
		.poll(
			async () => (await board(request)).shapes.filter((shape) => shape.type === 'frame').length,
		)
		.toBe(1)
	const framed = await board(request)
	const frame = framed.shapes.find((shape) => shape.type === 'frame') as CanvasShape | undefined
	if (!frame) throw new Error('Expected a frame')
	expect(
		framed.shapes
			.filter((shape) => shape.type !== 'connector' && shape.frameId === frame.id)
			.map((shape) => shape.id)
			.sort(),
	).toEqual(['a', 'b'])
	const child = framed.shapes.find((shape) => shape.id === 'a') as CanvasShape | undefined
	if (!child) throw new Error('Expected child a')
	const before = { x: child.x, y: child.y }
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	const frameBox = await page.locator(`[data-shape-id="${frame.id}"]`).boundingBox()
	if (!frameBox) throw new Error('Expected frame bounds')
	await page.mouse.click(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2)
	await expect(page.getByRole('region', { name: 'Selected object properties' })).toBeVisible()
	await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2)
	await page.mouse.down()
	await page.mouse.move(
		frameBox.x + frameBox.width / 2 + 96,
		frameBox.y + frameBox.height / 2 + 48,
		{ steps: 6 },
	)
	await page.mouse.up()
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((item) => item.id === 'a') as
				| CanvasShape
				| undefined
			return shape?.x
		})
		.not.toBe(before.x)
	const movedBoard = await board(request)
	const movedFrame = movedBoard.shapes.find((shape) => shape.id === frame.id) as
		| CanvasShape
		| undefined
	const movedChild = movedBoard.shapes.find((shape) => shape.id === 'a') as CanvasShape | undefined
	if (!movedFrame || !movedChild) throw new Error('Expected moved frame and child')
	expect(movedChild.x - before.x).toBe(movedFrame.x - frame.x)
	expect(movedChild.y - before.y).toBe(movedFrame.y - frame.y)
	await page.getByRole('button', { name: 'Delete selected' }).click()
	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.id === frame.id))
		.toBe(false)
	const ungrouped = (await board(request)).shapes.find((shape) => shape.id === 'a')
	expect(ungrouped?.type !== 'connector' ? ungrouped?.frameId : undefined).toBeUndefined()
})
test('rich widgets sit in isolated cards with editable items', async ({ page, request }) => {
	await page.getByRole('button', { name: 'Rich widget', exact: true }).click()
	await page.getByRole('button', { name: 'kanban', exact: true }).click()
	await page.mouse.click(700, 700)
	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'widget'))
		.toBe(true)
	const widget = (await board(request)).shapes.find((shape) => shape.type === 'widget') as
		| CanvasShape
		| undefined
	if (!widget || widget.type !== 'widget') throw new Error('Expected a widget')
	expect(widget).toMatchObject({ widget: 'kanban', widgetTitle: 'Delivery board' })
	expect(widget.items).toHaveLength(3)
	const card = page.locator(`[data-shape-id="${widget.id}"] .widget-card`)
	await expect(card).toHaveCount(1)
	await expect(card.locator('.kanban-column')).toHaveCount(3)

	await page.getByLabel('Widget title').fill('Launch board')
	await page.getByLabel('Widget title').press('Enter')
	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.id === widget.id))
		.toMatchObject({ widgetTitle: 'Launch board' })
	await page.getByRole('button', { name: 'Add widget item' }).click()
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((item) => item.id === widget.id) as
				| CanvasShape
				| undefined
			return shape?.items?.length
		})
		.toBe(4)
	await choose(page, 'Status Launch', 'done')
	await expect(
		page.locator(`[data-shape-id="${widget.id}"] .kanban-column.done article`),
	).toHaveCount(2)

	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Sticky note', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await page.mouse.click(1000, 150)
	await expect
		.poll(async () => (await board(request)).shapes.filter((shape) => shape.type === 'note').length)
		.toBe(1)
	const note = (await board(request)).shapes.find((shape) => shape.type === 'note') as
		| CanvasShape
		| undefined
	if (!note) throw new Error('Expected a note')
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	const view = await page.locator('[data-world-layer]').evaluate((element) => {
		const matrix = (element as SVGGElement).transform.baseVal.consolidate()?.matrix
		if (!matrix) throw new Error('Missing world transform')
		return { x: matrix.e, y: matrix.f, zoom: matrix.a }
	})
	const toScreen = (worldX: number, worldY: number) => ({
		x: view.x + worldX * view.zoom,
		y: view.y + worldY * view.zoom,
	})
	const noteCenter = toScreen(note.x + note.w / 2, note.y + note.h / 2)
	const widgetCenter = toScreen(widget.x + widget.w / 2, widget.y + widget.h / 2)
	await page.mouse.move(noteCenter.x, noteCenter.y)
	await page.mouse.down()
	await page.mouse.move(widgetCenter.x, widgetCenter.y, { steps: 8 })
	await page.mouse.up()
	await expect(page.locator('.notice')).toContainText('Rich widgets are isolated')
	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.id === note.id))
		.toMatchObject({ x: note.x, y: note.y })

	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await page.mouse.click(
		widgetCenter.x - widget.w * view.zoom * 0.3,
		widgetCenter.y - widget.h * view.zoom * 0.2,
	)
	await expect
		.poll(async () => (await board(request)).shapes.filter((shape) => shape.type === 'note').length)
		.toBe(1)
})

test('nested widgets stay draggable and text edits inline on double click', async ({
	page,
	request,
}) => {
	const current = await board(request)
	const response = await request.post('/api/operations', {
		data: {
			expectedRevision: current.revision,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'nest-frame',
						type: 'frame',
						x: 200,
						y: 200,
						w: 720,
						h: 460,
						color: '#5b5fc7',
						title: 'Nested',
					},
				},
				{
					type: 'create',
					shape: {
						id: 'nest-widget',
						type: 'widget',
						x: 240,
						y: 280,
						w: 460,
						h: 320,
						color: '#0f6cbd',
						widget: 'todo',
						widgetTitle: 'Inside frame',
						frameId: 'nest-frame',
						items: [{ id: 'n1', title: 'Task one', done: false }],
					},
				},
				{
					type: 'create',
					shape: {
						id: 'nest-text',
						type: 'text',
						x: 260,
						y: 640,
						w: 320,
						h: 48,
						color: '#242424',
						text: 'Inline',
						font: 'sans',
						fontSize: 32,
						fontWeight: 500,
					},
				},
			],
		},
	})
	expect(response.ok()).toBe(true)
	await page.reload()
	await page.locator('.status[aria-label="Live"]').waitFor()
	await page.getByRole('button', { name: 'Reset view' }).click()
	const view = await page.locator('[data-world-layer]').evaluate((element) => {
		const matrix = (element as SVGGElement).transform.baseVal.consolidate()?.matrix
		if (!matrix) throw new Error('Missing transform')
		return { x: matrix.e, y: matrix.f, zoom: matrix.a }
	})
	const screen = (x: number, y: number) => ({
		x: view.x + x * view.zoom,
		y: view.y + y * view.zoom,
	})

	const widgetPoint = screen(470, 440)
	await page.mouse.dblclick(widgetPoint.x, widgetPoint.y)
	const editor = page.locator('.inline-editor input')
	await expect(editor).toBeVisible()
	await editor.fill('Renamed board')
	await editor.press('Enter')
	await expect
		.poll(
			async () =>
				(
					(await board(request)).shapes.find((shape) => shape.id === 'nest-widget') as
						| CanvasShape
						| undefined
				)?.widgetTitle,
		)
		.toBe('Renamed board')

	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.mouse.move(widgetPoint.x, widgetPoint.y)
	await page.mouse.down()
	await page.mouse.move(widgetPoint.x + 96, widgetPoint.y + 48, { steps: 6 })
	await page.mouse.up()
	await expect
		.poll(
			async () =>
				(
					(await board(request)).shapes.find((shape) => shape.id === 'nest-widget') as
						| CanvasShape
						| undefined
				)?.x,
		)
		.not.toBe(240)
	const moved = (await board(request)).shapes.find((shape) => shape.id === 'nest-widget')
	expect(moved?.type !== 'connector' ? moved?.frameId : undefined).toBe('nest-frame')

	const textPoint = screen(420, 664)
	await page.mouse.dblclick(textPoint.x, textPoint.y)
	const textEditor = page.locator('.inline-editor textarea')
	await expect(textEditor).toBeVisible()
	await textEditor.fill('Edited inline')
	await page.keyboard.press('Control+Enter')
	await expect
		.poll(
			async () =>
				(
					(await board(request)).shapes.find((shape) => shape.id === 'nest-text') as
						| CanvasShape
						| undefined
				)?.text,
		)
		.toBe('Edited inline')
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
	if (!path || path.type !== 'path') throw new Error('Expected a path shape')
	expect(path.points?.length ?? 0).toBeGreaterThan(3)
	for (const point of path.points ?? []) {
		expect(point.x).toBeGreaterThanOrEqual(0)
		expect(point.x).toBeLessThanOrEqual(path.w)
		expect(point.y).toBeGreaterThanOrEqual(0)
		expect(point.y).toBeLessThanOrEqual(path.h)
	}
	await page.reload()
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
	await page.screenshot({ path: '/tmp/mico-connector-snap.png', animations: 'disabled' })
	await page.mouse.up()
	await expect.poll(async () => (await board(request)).shapes.length).toBe(6)
	const created = (await board(request)).shapes.find(
		(shape): shape is Connector => shape.type === 'connector' && shape.id !== 'edge',
	)
	expect(created).toMatchObject({ from: 'a', to: 'c', fromAnchor: 3, toAnchor: anchorIndex })
	await page.reload()
	await expect(page.locator('.canvas-shape')).toHaveCount(6)
})

test('either endpoint can be rebound without changing the opposite endpoint', async ({
	page,
	request,
}) => {
	await selectEdge(page)
	await dragEndpoint(page, 'to', 'c')
	await page.mouse.up()
	await expect.poll(async () => (await edge(request))?.to).toBe('c')
	expect(await edge(request)).toMatchObject({ from: 'a', fromAnchor: 3, toAnchor: 2 })
	await expect(page.locator('[data-connection-handle]')).toHaveCount(2)
	await dragEndpoint(page, 'from', 'd')
	await page.mouse.up()
	await expect.poll(async () => (await edge(request))?.from).toBe('d')
	expect(await edge(request)).toMatchObject({ to: 'c', toAnchor: 2 })
})

test('empty drops and Escape never persist a broken or partial connection', async ({
	page,
	request,
}) => {
	await selectEdge(page)
	const initial = await board(request)
	const start = await center(page.locator('[data-connection-handle="to"]'))
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(48, 800, { steps: 8 })
	await page.mouse.up()
	await expect(page.locator('[data-connection-handle]')).toHaveCount(2)
	expect(await board(request)).toEqual(initial)
	await dragEndpoint(page, 'to', 'c')
	await page.keyboard.press('Escape')
	await page.mouse.up()
	await expect(page.locator('.connection-preview')).toHaveCount(0)
	expect(await board(request)).toEqual(initial)
})

test('concurrent API edits are not overwritten by an in-flight endpoint drag', async ({
	page,
	request,
}) => {
	await selectEdge(page)
	await dragEndpoint(page, 'to', 'c')
	const response = await request.post('/api/operations', {
		data: { operations: [{ type: 'update', id: 'edge', patch: { color: '#0f6cbd' } }] },
	})
	expect(response.ok()).toBe(true)
	const updated = (await response.json()) as Board
	await expect(page.locator('.status')).toHaveAttribute(
		'title',
		`Revision ${updated.revision} · 5 objects`,
	)
	await page.mouse.up()
	await expect(page.locator('.notice')).toContainText('Object changed during drag')
	expect(await edge(request)).toMatchObject({ to: 'b', color: '#0f6cbd' })
	expect((await board(request)).revision).toBe(updated.revision)
})

test('endpoint rebinding has a keyboard alternative in the dock properties', async ({
	page,
	request,
}) => {
	await selectEdge(page)
	await page.getByRole('button', { name: 'Reconnect target', exact: true }).focus()
	await page.keyboard.press('Enter')
	await page.waitForTimeout(250)
	const target = page.getByRole('combobox', { name: 'Target', exact: true })
	await target.focus()
	await target.press('Space')
	await page.getByRole('option', { name: 'Event worker', exact: true }).click()
	await expect.poll(async () => (await edge(request))?.to).toBe('c')
})

test('pan and zoom preserve endpoint geometry and the compact frame remains reachable', async ({
	page,
}) => {
	await selectEdge(page)
	const beforePan = await center(page.locator('[data-connection-handle="from"]'))
	await page.getByRole('button', { name: 'Pan', exact: true }).click()
	await page.mouse.move(64, 800)
	await page.mouse.down()
	await page.mouse.move(128, 832, { steps: 4 })
	await page.mouse.up()
	const afterPan = await center(page.locator('[data-connection-handle="from"]'))
	expect(afterPan.x - beforePan.x).toBeCloseTo(64)
	expect(afterPan.y - beforePan.y).toBeCloseTo(32)
	await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
	await expect(page.locator('[data-connection-handle]')).toHaveCount(2)
	await page.setViewportSize({ width: 390, height: 844 })
	await page.getByRole('button', { name: 'Fit board', exact: true }).click()
	const viewport = page.viewportSize()
	if (!viewport) throw new Error('Missing viewport')
	for (const selector of ['.identity-panel', '.toolbar']) {
		const box = await page.locator(selector).boundingBox()
		expect(box).not.toBeNull()
		if (box) {
			expect(box.x).toBeGreaterThanOrEqual(0)
			expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
		}
	}
	const closePanel = page.getByRole('button', { name: 'Close properties', exact: true })
	if (await closePanel.count()) await closePanel.click()
	await page.mouse.move(0, 0)
	await page.screenshot({ path: '/tmp/mico-frame-mobile.png', animations: 'disabled' })
})
