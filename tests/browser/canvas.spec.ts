import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test'
import type { Board, CanvasShape, Connector } from '../../src/shared/types'

async function board(request: APIRequestContext): Promise<Board> {
	const response = await request.get('/api/board')
	expect(response.ok()).toBe(true)
	return response.json()
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
	await expect(page.locator('.status')).toContainText('Live')
	await expect(page.locator('.canvas-shape')).toHaveCount(5)
})

test('frame uses real icons, hover-only shortcuts and keyboard toolbar navigation', async ({
	page,
}) => {
	const toolbar = page.getByRole('toolbar', { name: 'Canvas tools' })
	await expect(toolbar.locator('button > svg.lucide')).toHaveCount(12)
	await expect(page.locator('.topbar .view-controls')).toHaveCount(0)
	await expect(toolbar.getByRole('group', { name: 'View controls', exact: true })).toBeVisible()
	const select = page.getByRole('button', { name: 'Select', exact: true })
	await expect(select.locator('kbd')).toBeHidden()
	await select.hover()
	await expect(select.locator('kbd')).toBeVisible()
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

test('fixed control and text tiers are selectable and survive a reload', async ({ page }) => {
	await page.getByRole('button', { name: 'Interface settings', exact: true }).click()
	const controls = page.getByRole('group', { name: 'Control size' })
	for (const [tier, height] of [
		['compact', '32px'],
		['standard', '40px'],
		['roomy', '48px'],
	] as const) {
		await controls.getByRole('button', { name: tier, exact: true }).click()
		await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveCSS(
			'height',
			height,
		)
	}
	await page
		.getByRole('group', { name: 'Text size' })
		.getByRole('button', { name: 'large', exact: true })
		.click()
	await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCSS('font-size', '16px')
	await page.keyboard.press('Escape')
	await expect(page.getByRole('button', { name: 'Interface settings', exact: true })).toBeFocused()
	await page.reload()
	await expect(page.locator('.app')).toHaveAttribute('data-control-tier', 'roomy')
	await expect(page.locator('.app')).toHaveAttribute('data-text-tier', 'large')
})

test('frame controls align to eight-pixel layout slots even on fractional viewport edges', async ({
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
				Math.abs(dimension / 8 - Math.round(dimension / 8)),
				`${control.label} must use grid-aligned geometry`,
			).toBeLessThan(0.001)
		}
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
	await expect(page.locator('[data-grid-level="fine"]')).toHaveAttribute(
		'd',
		'M8 0V64M0 8H64M16 0V64M0 16H64M24 0V64M0 24H64M40 0V64M0 40H64M48 0V64M0 48H64M56 0V64M0 56H64',
	)
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

test('all dock controls and the upward settings panel remain on-screen at every size tier', async ({
	page,
}) => {
	for (const width of [360, 390, 768, 1440]) {
		await page.setViewportSize({ width, height: 844 })
		for (const tier of ['compact', 'standard', 'roomy']) {
			await page.getByRole('button', { name: 'Interface settings', exact: true }).click()
			await page
				.getByRole('group', { name: 'Control size' })
				.getByRole('button', { name: tier, exact: true })
				.click()
			const panel = await page.locator('.settings-panel').boundingBox()
			const dock = await page.getByRole('toolbar').boundingBox()
			if (!panel || !dock) throw new Error('Expected dock and settings panel')
			expect(panel.x).toBeGreaterThanOrEqual(0)
			expect(panel.x + panel.width).toBeLessThanOrEqual(width)
			expect(panel.y).toBeGreaterThanOrEqual(0)
			expect(panel.y + panel.height).toBeLessThanOrEqual(dock.y - 16)
			await page.keyboard.press('Escape')
			for (const button of await page.getByRole('toolbar').getByRole('button').all()) {
				await expect(button).toBeVisible()
				const box = await button.boundingBox()
				if (!box) throw new Error('Expected a visible dock control')
				expect(box.x).toBeGreaterThanOrEqual(0)
				expect(box.x + box.width).toBeLessThanOrEqual(width)
				expect(box.y + box.height).toBeLessThanOrEqual(844)
			}
		}
	}
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

test('endpoint rebinding has a keyboard alternative in the inspector', async ({
	page,
	request,
}) => {
	await selectEdge(page)
	await page.getByRole('button', { name: 'Reconnect target', exact: true }).focus()
	await page.keyboard.press('Enter')
	await expect(page.getByLabel('Target', { exact: true })).toBeFocused()
	await page.getByLabel('Target', { exact: true }).selectOption('c')
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
	await page.getByRole('button', { name: 'Close inspector', exact: true }).click()
	await page.mouse.move(0, 0)
	await page.screenshot({ path: '/tmp/mico-frame-mobile.png', animations: 'disabled' })
})
