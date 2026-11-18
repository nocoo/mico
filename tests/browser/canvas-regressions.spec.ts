import { expect, test } from '@playwright/test'
import {
	board,
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

test('drawn shapes commit alongside concurrent edits without conflicts', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		{ id: 'backdrop', type: 'rectangle', x: 180, y: 180, w: 260, h: 180, color: '#00a2e1' },
	])
	await openCanvas(page)
	await resetView(page)

	let operationCalls = 0
	let concurrentInjected = false
	await page.route('**/api/operations', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue()
			return
		}
		operationCalls += 1
		if (operationCalls === 1 && !concurrentInjected) {
			concurrentInjected = true
			const bump = await request.post('/api/operations', {
				data: {
					operations: [
						{
							type: 'create',
							shape: {
								id: 'concurrent-note',
								type: 'note',
								x: 620,
								y: 180,
								w: 160,
								h: 160,
								color: '#fff8d4',
								text: 'Concurrent edit',
							},
						},
					],
				},
			})
			expect(bump.ok()).toBe(true)
		}
		await route.continue()
	})

	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	const start = await worldPoint(page, 240, 240)
	const end = await worldPoint(page, 400, 340)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps: 6 })
	await page.mouse.up()

	expect(operationCalls).toBe(1)
	await expect
		.poll(async () => {
			const data = await board(request)
			return data.shapes.filter((shape) => shape.type === 'rectangle').length
		})
		.toBe(2)
	await expect(page.locator('[data-shape-id]')).toHaveCount(3)
	await expect(page.locator('.notice')).toHaveCount(0)
})

test('fast brush stroke captures pointerup endpoint via ref', async ({ page, request }) => {
	await resetBoard(request, [])
	await openCanvas(page)
	await resetView(page)

	await page.getByRole('button', { name: 'Brush', exact: true }).click()
	const start = await worldPoint(page, 300, 420)
	const end = await worldPoint(page, 440, 500)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y)
	await page.mouse.up()

	await expect
		.poll(async () => {
			const res = await request.get('/api/board')
			const data = (await res.json()) as { shapes: { type: string }[] }
			return data.shapes.filter((shape) => shape.type === 'path').length
		})
		.toBe(1)
})

test('a lost create acknowledgement keeps the drawing and enables undo', async ({
	page,
	request,
}) => {
	await resetBoard(request, [])
	let releaseBoards: (() => void) | undefined
	const boardsHeld = new Promise<void>((resolve) => {
		releaseBoards = resolve
	})
	await page.routeWebSocket(/\/api\/events/, async (socket) => {
		const server = socket.connectToServer()
		const held: string[] = []
		socket.onMessage((message) => server.send(message))
		server.onMessage((raw) => {
			const message = typeof raw === 'string' ? raw : raw.toString()
			const event = JSON.parse(message) as { type?: string }
			if (event.type === 'board') {
				held.push(message)
				return
			}
			socket.send(message)
		})
		await boardsHeld
		for (const message of held) socket.send(message)
	})

	let createPosts = 0
	await page.route('**/api/operations', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue()
			return
		}
		const payload = route.request().postDataJSON() as { operations?: { type?: string }[] }
		if (payload.operations?.[0]?.type !== 'create') {
			await route.continue()
			return
		}
		createPosts += 1
		await route.fetch()
		await route.abort('failed')
	})

	await openCanvas(page)
	await resetView(page)
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	const start = await worldPoint(page, 300, 260)
	const end = await worldPoint(page, 480, 380)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps: 6 })
	await page.mouse.up()

	await expect.poll(() => createPosts).toBe(1)
	await expect(page.locator('[data-shape-id]')).toHaveCount(1)
	await expect(page.locator('.notice')).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	await expect
		.poll(
			async () =>
				(await board(request)).shapes.filter((shape) => shape.type === 'rectangle').length,
		)
		.toBe(1)

	releaseBoards?.()
	await expect(page.locator('[data-shape-id]')).toHaveCount(1)
	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await expect(page.locator('[data-shape-id]')).toHaveCount(1)
	await expect
		.poll(
			async () =>
				(await board(request)).shapes.filter((shape) => shape.type === 'rectangle').length,
		)
		.toBe(1)
})

test('independent draws commit once beside concurrent peer edits', async ({
	page,
	context,
	request,
}) => {
	await resetBoard(request, [])
	await context.route('/api/runtime', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				auth: { mode: 'demo' },
				aiEnabled: false,
				aiSettingsVisible: false,
				mossEnabled: false,
				ephemeral: false,
			}),
		}),
	)
	const peer = await context.newPage()
	await peer.goto('/?username=Editor')
	await expect(peer.locator('.whiteboard-cursors')).toHaveCount(1)

	let authorCreates = 0
	let holdNext = false
	let held = false
	let releaseCreate: (() => void) | undefined
	const createGate = new Promise<void>((resolve) => {
		releaseCreate = resolve
	})
	await page.route('**/api/operations', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue()
			return
		}
		const payload = route.request().postDataJSON() as { operations?: { type?: string }[] }
		if (payload.operations?.[0]?.type === 'create') {
			authorCreates += 1
			if (holdNext) {
				held = true
				await createGate
			}
		}
		await route.continue()
	})

	await page.goto('/?sharer=true&username=Host')
	await expect(page.locator('.whiteboard-cursors')).toHaveCount(1)
	await resetView(page)

	await peer.mouse.move(600, 400)
	await peer.mouse.move(720, 460)
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	const controlStart = await worldPoint(page, 260, 300)
	const controlEnd = await worldPoint(page, 380, 380)
	await page.mouse.move(controlStart.x, controlStart.y)
	await page.mouse.down()
	await page.mouse.move(controlEnd.x, controlEnd.y, { steps: 4 })
	await page.mouse.up()
	await expect.poll(() => authorCreates).toBe(1)
	await expect.poll(async () => (await board(request)).shapes.length).toBe(1)
	await expect(peer.locator('[data-shape-id]:not(.whiteboard-remote-selection)')).toHaveCount(1)

	holdNext = true
	const start = await worldPoint(page, 420, 300)
	const end = await worldPoint(page, 560, 400)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps: 4 })
	await page.mouse.up()
	await expect.poll(() => held).toBe(true)
	for (let index = 0; index < 4; index++) {
		const committed = await request.post('/api/operations', {
			data: {
				operations: [
					{
						type: 'create',
						shape: {
							id: `peer-note-${index}`,
							type: 'note',
							x: 700,
							y: 120 + index * 180,
							w: 140,
							h: 140,
							color: '#fff8d4',
							text: `Peer ${index}`,
						},
					},
				],
			},
		})
		expect(committed.ok()).toBe(true)
	}
	releaseCreate?.()

	await expect.poll(() => authorCreates).toBe(2)
	await expect
		.poll(
			async () =>
				(await board(request)).shapes.filter((shape) => shape.type === 'rectangle').length,
		)
		.toBe(2)
	await expect.poll(async () => (await board(request)).shapes.length).toBe(6)
	await expect(page.locator('[data-shape-id]')).toHaveCount(6)
	await expect(peer.locator('[data-shape-id]:not(.whiteboard-remote-selection)')).toHaveCount(6)
	await expect(page.locator('.notice')).toHaveCount(0)
	await page.reload()
	await expect(page.locator('[data-shape-id]')).toHaveCount(6)
	await peer.close()
})

test('a rejected create stays visible with a reason and never reaches the board', async ({
	page,
	request,
}) => {
	await resetBoard(request, [])
	await openCanvas(page)
	await resetView(page)
	await page.route('**/api/operations', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue()
			return
		}
		const payload = route.request().postDataJSON() as { operations?: { type?: string }[] }
		if (payload.operations?.[0]?.type === 'create') {
			await route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: JSON.stringify({
					error: 'DUPLICATE_ID',
					message: 'shape id already exists: rejected-draw',
				}),
			})
			return
		}
		await route.continue()
	})

	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	const start = await worldPoint(page, 280, 240)
	const end = await worldPoint(page, 440, 360)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps: 4 })
	await page.mouse.up()

	await expect(page.locator('.notice')).toContainText('Not saved: shape id already exists')
	await expect(page.locator('[data-shape-id]')).toHaveCount(1)
	await expect.poll(async () => (await board(request)).shapes.length).toBe(0)

	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await expect(page.locator('[data-shape-id]')).toHaveCount(0)
})

test('undoing a concurrently committed create keeps peer shapes', async ({ page, request }) => {
	await resetBoard(request, [])
	await openCanvas(page)
	await resetView(page)

	let releaseCreate: (() => void) | undefined
	const createGate = new Promise<void>((resolve) => {
		releaseCreate = resolve
	})
	let held = false
	await page.route('**/api/operations', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue()
			return
		}
		const payload = route.request().postDataJSON() as { operations?: { type?: string }[] }
		if (payload.operations?.[0]?.type === 'create' && !held) {
			held = true
			await createGate
		}
		await route.continue()
	})

	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	const start = await worldPoint(page, 260, 240)
	const end = await worldPoint(page, 420, 360)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps: 4 })
	await page.mouse.up()
	await expect.poll(() => held).toBe(true)

	const peerWrite = await request.post('/api/operations', {
		data: {
			operations: [
				{
					type: 'create',
					shape: {
						id: 'peer-note-concurrent',
						type: 'note',
						x: 680,
						y: 220,
						w: 160,
						h: 140,
						color: '#fff8d4',
						text: 'Peer note',
					},
				},
			],
		},
	})
	expect(peerWrite.ok()).toBe(true)
	releaseCreate?.()

	await expect.poll(async () => (await board(request)).shapes.length).toBe(2)
	await expect(page.locator('[data-shape-id]')).toHaveCount(2)

	await page.keyboard.press('ControlOrMeta+z')
	await expect
		.poll(async () => (await board(request)).shapes.map((s) => s.id))
		.toEqual(['peer-note-concurrent'])
	await expect(page.locator('[data-shape-id="peer-note-concurrent"]')).toHaveCount(1)
})
