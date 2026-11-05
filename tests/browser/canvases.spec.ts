import { type APIRequestContext, expect, type Route, test } from '@playwright/test'
import type { Board, CanvasSnapshot, CanvasSummary } from '../../src/shared/types'
import { clickWorld, ISOLATED_ORIGIN, resetBoard, resetView, worldPoint } from './support'

async function state(request: APIRequestContext): Promise<CanvasSnapshot> {
	const response = await request.get('/api/state')
	expect(response.ok()).toBe(true)
	return response.json()
}

async function resetCanvases(request: APIRequestContext): Promise<CanvasSnapshot> {
	const current = await state(request)
	const keep = current.canvases[0]
	for (const canvas of current.canvases.slice(1)) {
		const response = await request.delete(`/api/canvases/${canvas.id}`)
		expect(response.ok()).toBe(true)
	}
	const activated = await request.put('/api/active-canvas', { data: { id: keep.id } })
	expect(activated.ok()).toBe(true)
	const renamed = await request.patch(`/api/canvases/${keep.id}`, {
		data: { name: 'My canvas' },
	})
	expect(renamed.ok()).toBe(true)
	await resetBoard(request, [])
	return state(request)
}

function assertConnector(shapes: Board['shapes']) {
	const connector = shapes.find(
		(shape) => shape.type === 'connector' && shape.from === 'from' && shape.to === 'to',
	)
	expect(connector).toBeDefined()
}

function byName(canvases: CanvasSummary[], name: string): CanvasSummary {
	const canvas = canvases.find((candidate) => candidate.name === name)
	if (!canvas) throw new Error(`Missing canvas ${name}`)
	return canvas
}

test.beforeEach(async ({ page, request, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetCanvases(request)
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await resetView(page)
})

test.afterEach(async ({ request }) => {
	await resetCanvases(request)
})

test('canvas panel lists names, times and previews and closes cleanly', async ({
	page,
	request,
}) => {
	const initial = await state(request)
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	const panel = page.getByRole('region', { name: 'Canvases' })
	await expect(panel).toBeVisible()
	await expect(panel.locator('.canvas-item')).toHaveCount(1)
	const item = panel.locator('.canvas-item').first()
	await expect(item.locator('.canvas-name')).toHaveText('My canvas')
	await expect(item.locator('.canvas-time')).not.toBeEmpty()
	await expect(item.locator('.canvas-preview')).toHaveAttribute(
		'src',
		/^data:image\/svg\+xml;base64,/,
	)
	await expect(item).toHaveClass(/active/)
	await expect(page.locator(`[aria-label="Open canvas My canvas"]`)).toHaveAttribute(
		'aria-current',
		'true',
	)
	await panel.evaluate(async (element) => {
		await Promise.all(
			element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
		)
	})
	const addBox = await page.getByRole('button', { name: 'New canvas', exact: true }).boundingBox()
	const activeBox = await item.locator('.canvas-active').boundingBox()
	if (!addBox || !activeBox) throw new Error('Expected the add and active controls')
	expect(activeBox.width).toBe(32)
	expect(addBox.width).toBe(32)
	expect(activeBox.x + activeBox.width).toBeCloseTo(addBox.x + addBox.width, 5)
	expect(activeBox.x + activeBox.width / 2).toBeCloseTo(addBox.x + addBox.width / 2, 5)
	expect(initial.canvases[0].preview ?? '').toMatch(/^data:image\/svg\+xml;base64,/)

	await page.mouse.click(900, 700)
	await expect(panel).toHaveCount(0)
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await expect(panel).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(panel).toHaveCount(0)
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await expect(panel).toBeVisible()
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await expect(panel).toHaveCount(0)
})

test('creating and switching canvases keeps each board and survives reload', async ({
	page,
	request,
}) => {
	await expect(page).toHaveTitle('mico · My canvas')
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await clickWorld(page, 500, 400)
	await expect.poll(async () => (await state(request)).board.shapes.length).toBe(1)
	const main = await state(request)
	const mainCanvas = main.canvases[0]
	const noteId = main.board.shapes[0].id

	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await page.getByRole('button', { name: 'New canvas', exact: true }).click()
	await expect.poll(async () => (await state(request)).canvases.length).toBe(2)
	const afterCreate = await state(request)
	expect(afterCreate.activeCanvasId).not.toBe(mainCanvas.id)
	expect(afterCreate.board.shapes).toHaveLength(0)
	const second = afterCreate.canvases.find((canvas) => canvas.id === afterCreate.activeCanvasId)
	if (!second) throw new Error('Missing created canvas')
	expect(second.name).toBe('Canvas 2')
	await expect(page).toHaveTitle('mico · Canvas 2')

	await page.keyboard.press('Escape')
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await page.mouse.move(500, 500)
	await page.mouse.down()
	await page.mouse.move(620, 580, { steps: 6 })
	await page.mouse.up()
	await expect.poll(async () => (await state(request)).board.shapes).toHaveLength(1)

	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await page.getByRole('button', { name: 'Open canvas My canvas', exact: true }).click()
	await expect.poll(async () => (await state(request)).activeCanvasId).toBe(mainCanvas.id)
	await expect(page).toHaveTitle('mico · My canvas')
	await expect(page.locator(`[data-shape-id="${noteId}"]`)).toHaveCount(1)

	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await expect.poll(async () => (await state(request)).activeCanvasId).toBe(mainCanvas.id)
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await expect(page.getByRole('region', { name: 'Canvases' }).locator('.canvas-item')).toHaveCount(
		2,
	)
	await page.getByRole('button', { name: 'Open canvas Canvas 2', exact: true }).click()
	await expect.poll(async () => (await state(request)).activeCanvasId).toBe(second.id)
	await expect(page).toHaveTitle('mico · Canvas 2')
	await expect(page.locator('.canvas-shape')).toHaveCount(1)
})

test('renaming and deleting canvases uses the panel and keeps one canvas', async ({
	page,
	request,
}) => {
	const created = await request.post('/api/canvases', {
		data: { name: 'Second canvas', activate: false },
	})
	expect(created.ok()).toBe(true)
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	const panel = page.getByRole('region', { name: 'Canvases' })
	await expect(panel.locator('.canvas-item')).toHaveCount(2)

	const mainItem = panel.locator('.canvas-item').filter({ hasText: 'My canvas' })
	await mainItem.hover()
	await panel.getByRole('button', { name: 'Rename My canvas', exact: true }).click()
	const nameInput = panel.getByLabel('Canvas name')
	await nameInput.fill('Renamed canvas')
	await nameInput.press('Enter')
	await expect
		.poll(async () =>
			(await state(request)).canvases.some((canvas) => canvas.name === 'Renamed canvas'),
		)
		.toBe(true)
	await expect(page).toHaveTitle('mico · Renamed canvas')

	const secondItem = panel.locator('.canvas-item').filter({ hasText: 'Second canvas' })
	await secondItem.hover()
	await panel.getByRole('button', { name: 'Delete Second canvas', exact: true }).click()
	await panel.getByRole('button', { name: 'Confirm delete Second canvas', exact: true }).click()
	await expect.poll(async () => (await state(request)).canvases.length).toBe(1)
	await expect(panel.locator('.canvas-item')).toHaveCount(1)
	await expect(
		panel.getByRole('button', { name: 'Delete Renamed canvas', exact: true }),
	).toBeDisabled()
})

test('AI canvas operations update lists and synchronize the active canvas', async ({
	page,
	request,
}) => {
	const created = await request.post('/api/canvases', {
		data: { name: 'AI canvas', activate: false },
	})
	expect(created.ok()).toBe(true)
	const createdState = (await created.json()) as CanvasSnapshot & { createdCanvasId: string }
	const target = byName(createdState.canvases, 'AI canvas')

	const before = await state(request)
	const written = await request.post('/api/operations', {
		data: {
			canvasId: target.id,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'ai-note',
						type: 'note',
						x: 100,
						y: 100,
						w: 120,
						h: 120,
						color: '#fff8d4',
						text: 'From API',
					},
				},
			],
		},
	})
	expect(written.ok()).toBe(true)
	await expect
		.poll(async () => {
			const current = await state(request)
			const canvas = current.canvases.find((candidate) => candidate.id === target.id)
			return canvas?.preview
		})
		.not.toBe(byName(before.canvases, 'AI canvas').preview)
	const activeBefore = (await state(request)).activeCanvasId
	expect(activeBefore).toBe(before.activeCanvasId)

	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await page.getByRole('button', { name: 'Open canvas AI canvas', exact: true }).click()
	await expect.poll(async () => (await state(request)).activeCanvasId).toBe(target.id)
	await expect(page.locator('[data-shape-id="ai-note"]')).toHaveCount(1)

	const switched = await request.put('/api/active-canvas', { data: { id: activeBefore } })
	expect(switched.ok()).toBe(true)
	await expect.poll(async () => (await state(request)).activeCanvasId).toBe(activeBefore)
	await expect(page.locator('[data-shape-id="ai-note"]')).toHaveCount(0)

	const deleted = await request.delete(`/api/canvases/${target.id}`)
	expect(deleted.ok()).toBe(true)
	await expect.poll(async () => (await state(request)).canvases.length).toBe(1)
	await expect(
		page.getByRole('button', { name: 'Open canvas AI canvas', exact: true }),
	).toHaveCount(0)
})

test('preview thumbnails refresh after drawing', async ({ page, request }) => {
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	const panel = page.getByRole('region', { name: 'Canvases' })
	const preview = panel.locator('.canvas-preview').first()
	const first = await preview.getAttribute('src')
	await page.keyboard.press('Escape')

	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await clickWorld(page, 700, 450)
	await expect.poll(async () => (await state(request)).board.shapes.length).toBe(1)

	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await expect.poll(async () => preview.getAttribute('src')).not.toBe(first)
	const refreshed = await preview.getAttribute('src')
	await page.waitForTimeout(3300)
	await expect(preview).toHaveAttribute('src', refreshed ?? '')
})

test('panel controls activate with Space and stale state snapshots cannot revert a switch', async ({
	page,
	request,
}) => {
	const noteA = {
		id: 'note-a',
		type: 'note' as const,
		x: 200,
		y: 200,
		w: 120,
		h: 120,
		color: '#fff8d4',
		text: 'Canvas A',
	}
	await resetBoard(request, [noteA])
	await expect(page.locator('[data-shape-id="note-a"]')).toHaveCount(1)
	const activeA = (await state(request)).activeCanvasId
	const created = await request.post('/api/canvases', {
		data: { name: 'Canvas B', activate: false },
	})
	const createdState = (await created.json()) as { createdCanvasId: string }
	await request.post('/api/operations', {
		data: {
			canvasId: createdState.createdCanvasId,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'note-b',
						type: 'note',
						x: 200,
						y: 200,
						w: 120,
						h: 120,
						color: '#ffe9f0',
						text: 'Canvas B',
					},
				},
			],
		},
	})
	const stale = await state(request)
	expect(stale.activeCanvasId).toBe(activeA)

	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	const panel = page.getByRole('region', { name: 'Canvases' })
	await page.getByRole('button', { name: 'New canvas', exact: true }).focus()
	await page.keyboard.press('Space')
	await expect.poll(async () => (await state(request)).canvases.length).toBe(3)
	await page.getByRole('button', { name: 'Open canvas My canvas', exact: true }).focus()
	await page.keyboard.press('Space')
	await expect.poll(async () => (await state(request)).activeCanvasId).toBe(activeA)
	await expect(page.locator(`[aria-label="Open canvas My canvas"]`)).toHaveAttribute(
		'aria-current',
		'true',
	)

	let staleServed = 0
	await page.route('**/api/state*', async (route) => {
		staleServed += 1
		await route.fulfill({ json: stale })
	})
	const switched = await request.put('/api/active-canvas', {
		data: { id: createdState.createdCanvasId },
	})
	expect(switched.ok()).toBe(true)
	await expect(page.locator('[data-shape-id="note-b"]')).toHaveCount(1)
	await expect(page.locator('[data-shape-id="note-a"]')).toHaveCount(0)
	await expect.poll(() => staleServed).toBeGreaterThan(0)
	await page.waitForTimeout(250)
	await expect(page.locator('[data-shape-id="note-b"]')).toHaveCount(1)
	await expect(page.locator('[data-shape-id="note-a"]')).toHaveCount(0)
	expect((await state(request)).activeCanvasId).toBe(createdState.createdCanvasId)
	await page.unroute('**/api/state*')
	void panel
})

test('switching canvases clears a pending connection save without losing it', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		{
			id: 'from',
			type: 'rectangle',
			x: 200,
			y: 200,
			w: 180,
			h: 90,
			color: '#0b7ba8',
			text: 'From',
		},
		{ id: 'to', type: 'rectangle', x: 600, y: 200, w: 180, h: 90, color: '#5c8c1e', text: 'To' },
	])
	await expect(page.locator('[data-shape-id="from"]')).toHaveCount(1)
	await expect(page.locator('[data-shape-id="to"]')).toHaveCount(1)
	const activeBefore = (await state(request)).activeCanvasId
	const created = await request.post('/api/canvases', {
		data: { name: 'Other canvas', activate: false },
	})
	const otherId = ((await created.json()) as { createdCanvasId: string }).createdCanvasId
	await request.post('/api/operations', {
		data: {
			canvasId: otherId,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'other-note',
						type: 'note',
						x: 200,
						y: 200,
						w: 120,
						h: 120,
						color: '#fff8d4',
					},
				},
			],
		},
	})

	let held: Route | undefined
	await page.route('**/api/operations', async (route) => {
		held = route
	})
	await page.getByRole('button', { name: 'Connector', exact: true }).click()
	const from = await worldPoint(page, 290, 245)
	const to = await worldPoint(page, 690, 245)
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(to.x, to.y, { steps: 8 })
	await page.mouse.up()
	await expect(page.locator('.connector-tip')).toHaveText('Saving connection…')

	const switched = await request.put('/api/active-canvas', { data: { id: otherId } })
	expect(switched.ok()).toBe(true)
	await expect(page.locator('[data-shape-id="other-note"]')).toHaveCount(1)
	await expect(page.locator('.connection-preview')).toHaveCount(0)
	await expect(page.locator('.connector-tip')).not.toContainText('Saving connection')
	if (!held) throw new Error('Expected a held operation')
	const saved = await request.post('/api/operations', {
		data: held.request().postDataJSON(),
	})
	expect(saved.ok()).toBe(true)
	await held.fulfill({ json: await saved.json() })
	await page.unroute('**/api/operations')
	const back = await request.put('/api/active-canvas', { data: { id: activeBefore } })
	expect(back.ok()).toBe(true)
	await expect.poll(async () => (await state(request)).board.shapes.length).toBe(3)
	assertConnector((await state(request)).board.shapes)
	const otherBoard = await request.get(`/api/canvases/${otherId}`)
	expect(((await otherBoard.json()) as { board: Board }).board.shapes).toHaveLength(1)
})

test('queued edits finish on their original canvas after switching away', async ({
	page,
	request,
}) => {
	await resetBoard(request, [])
	const activeBefore = (await state(request)).activeCanvasId
	const created = await request.post('/api/canvases', {
		data: { name: 'Queued target', activate: false },
	})
	const otherId = ((await created.json()) as { createdCanvasId: string }).createdCanvasId
	await request.post('/api/operations', {
		data: {
			canvasId: otherId,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'other-note',
						type: 'note',
						x: 100,
						y: 100,
						w: 100,
						h: 100,
						color: '#fff8d4',
					},
				},
			],
		},
	})

	let held: Route | undefined
	let heldResult: unknown
	let firstResolved: () => void = () => {}
	const firstRequest = new Promise<void>((resolve) => {
		firstResolved = resolve
	})
	let operationCount = 0
	await page.route('**/api/operations', async (route) => {
		operationCount += 1
		if (operationCount > 1) {
			await route.continue()
			return
		}
		held = route
		const response = await request.post('/api/operations', {
			data: route.request().postDataJSON(),
		})
		expect(response.ok()).toBe(true)
		heldResult = await response.json()
		firstResolved()
	})

	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await page.mouse.move(300, 300)
	await page.mouse.down()
	await page.mouse.move(420, 380, { steps: 6 })
	await page.mouse.up()
	await firstRequest
	await page.mouse.move(500, 300)
	await page.mouse.down()
	await page.mouse.move(620, 380, { steps: 6 })
	await page.mouse.up()

	const switched = await request.put('/api/active-canvas', { data: { id: otherId } })
	expect(switched.ok()).toBe(true)
	await expect(page.locator('[data-shape-id="other-note"]')).toHaveCount(1)
	if (!held) throw new Error('Expected a held operation')
	await held.fulfill({ json: heldResult })
	await expect.poll(async () => (await state(request)).canvases.length).toBe(2)
	await expect
		.poll(async () => {
			const stateNow = await state(request)
			return stateNow.canvases.find((canvas) => canvas.id === activeBefore)?.revision
		})
		.toBeGreaterThanOrEqual(2)
	await page.unroute('**/api/operations')
	const back = await request.put('/api/active-canvas', { data: { id: activeBefore } })
	expect(back.ok()).toBe(true)
	await expect.poll(async () => (await state(request)).board.shapes.length).toBe(2)
})

test('delayed list responses cannot roll back a newer preview', async ({ page, request }) => {
	await resetBoard(request, [
		{
			id: 'seed-note',
			type: 'note',
			x: 200,
			y: 200,
			w: 120,
			h: 120,
			color: '#fff8d4',
			text: 'Seed',
		},
	])
	await expect(page.locator('[data-shape-id="seed-note"]')).toHaveCount(1)
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	const panel = page.getByRole('region', { name: 'Canvases' })
	const staleList = (await (await request.get('/api/canvases')).json()) as {
		stateVersion: number
		canvases: CanvasSummary[]
	}
	const stalePreview = staleList.canvases[0].preview ?? ''
	await page.keyboard.press('Escape')
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await clickWorld(page, 700, 450)
	await expect.poll(async () => (await state(request)).board.shapes.length).toBe(2)
	const fresh = await state(request)
	const freshPreview = fresh.canvases[0].preview ?? ''
	expect(freshPreview).not.toBe(stalePreview)

	await page.route('**/api/canvases', async (route) => {
		await route.fulfill({ json: staleList })
	})
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await expect(panel).toBeVisible()
	await expect(panel.locator('.canvas-preview').first()).toHaveAttribute('src', freshPreview)
	await page.unroute('**/api/canvases')
})

test('a queued frame selection keeps its captured revision guard', async ({ page, request }) => {
	await resetBoard(request, [
		{ id: 'a', type: 'rectangle', x: 200, y: 200, w: 160, h: 80, color: '#0b7ba8', text: 'A' },
		{ id: 'b', type: 'rectangle', x: 500, y: 200, w: 160, h: 80, color: '#5c8c1e', text: 'B' },
	])
	await expect(page.locator('[data-shape-id="a"]')).toHaveCount(1)
	await expect(page.locator('[data-shape-id="b"]')).toHaveCount(1)

	let firstRoute: Route | undefined
	let firstResult: unknown
	let secondBody: unknown
	let secondStatus: number | undefined
	let calls = 0
	let firstResolved: () => void = () => {}
	const firstRequest = new Promise<void>((resolve) => {
		firstResolved = resolve
	})
	await page.route('**/api/operations', async (route) => {
		calls += 1
		const body = route.request().postDataJSON()
		const response = await request.post('/api/operations', { data: body })
		if (calls === 1) {
			expect(response.ok()).toBe(true)
			firstResult = await response.json()
			firstRoute = route
			firstResolved()
			return
		}
		secondBody = body
		secondStatus = response.status()
		await route.fulfill({ status: response.status(), json: await response.json() })
	})

	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await page.mouse.move(800, 300)
	await page.mouse.down()
	await page.mouse.move(900, 380, { steps: 6 })
	await page.mouse.up()
	await firstRequest

	await page.getByRole('button', { name: 'Select', exact: true }).click()
	const start = await worldPoint(page, 120, 120)
	const end = await worldPoint(page, 720, 360)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps: 8 })
	await page.mouse.up()
	await expect(page.locator('.selection')).toHaveCount(2)
	await page.getByRole('button', { name: 'Frame selection' }).click()

	const remote = await request.post('/api/operations', {
		data: {
			operations: [
				{
					type: 'create',
					shape: {
						id: 'remote-note',
						type: 'note',
						x: 100,
						y: 500,
						w: 100,
						h: 100,
						color: '#fff8d4',
					},
				},
			],
		},
	})
	expect(remote.ok()).toBe(true)
	const remoteRevision = ((await remote.json()) as Board).revision
	await expect(page.locator('[data-shape-id="remote-note"]')).toHaveCount(1)

	if (!firstRoute) throw new Error('Expected the first operation to be held')
	await firstRoute.fulfill({ json: firstResult })
	await expect.poll(() => secondStatus).toBeDefined()
	expect((secondBody as { expectedRevision: number }).expectedRevision).toBeLessThan(remoteRevision)
	expect(secondStatus).toBe(409)
	await expect(page.locator('.notice')).toContainText('HTTP 409')
	await page.unroute('**/api/operations')
	const after = await state(request)
	expect(after.board.shapes.some((shape) => shape.type === 'frame')).toBe(false)
	expect(after.board.shapes.map((shape) => shape.id)).toEqual(
		expect.arrayContaining(['a', 'b', 'remote-note']),
	)
	expect(after.board.shapes).toHaveLength(4)
})
