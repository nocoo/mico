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
	await closeAssistant(page)
	await resetView(page)
})

test('image keeps its rounded border and clips its corners when selected and unselected', async ({
	page,
	request,
}) => {
	const png = await page.evaluate(() => {
		const canvas = document.createElement('canvas')
		canvas.width = 2
		canvas.height = 2
		const context = canvas.getContext('2d')
		if (!context) throw new Error('Missing canvas context')
		context.fillStyle = '#00ff00'
		context.fillRect(0, 0, 2, 2)
		return canvas.toDataURL('image/png').split(',')[1]
	})
	const upload = await request.post('/api/images', {
		headers: { 'Content-Type': 'image/png' },
		data: Buffer.from(png, 'base64'),
	})
	expect(upload.ok()).toBe(true)
	const { id } = (await upload.json()) as { id: string }
	await page.evaluate(async (assetId) => {
		const image = new Image()
		image.src = `/api/images/${assetId}`
		await image.decode()
	}, id)
	await seed(page, request, [
		{ id: 'image', type: 'image', imageId: id, x: 200, y: 200, w: 160, h: 160, color: '#ff0000' },
	])
	const image = page.locator('[data-shape-id="image"]')
	await expect(image.locator('.canvas-image')).toHaveCount(1)

	for (const selected of [false, true]) {
		if (selected) {
			await clickWorld(page, 280, 280)
			await expect(image.locator('.selection')).toHaveCount(1)
		}
		await page.mouse.move(600, 600)
		const screenshot = await page.screenshot({ clip: { x: 198, y: 198, width: 164, height: 164 } })
		const pixels = await page.evaluate(async (base64) => {
			const image = new Image()
			image.src = `data:image/png;base64,${base64}`
			await image.decode()
			const canvas = document.createElement('canvas')
			canvas.width = image.width
			canvas.height = image.height
			const context = canvas.getContext('2d')
			if (!context) throw new Error('Missing canvas context')
			context.drawImage(image, 0, 0)
			return Array.from(context.getImageData(0, 0, image.width, image.height).data)
		}, screenshot.toString('base64'))
		const pixel = (x: number, y: number) => pixels.slice((y * 164 + x) * 4, (y * 164 + x) * 4 + 3)
		for (const [left, top] of [
			[2, 2],
			[152, 2],
			[2, 152],
			[152, 152],
		]) {
			let red = 0
			for (let y = top; y < top + 10; y++) {
				for (let x = left; x < left + 10; x++) {
					const [r, g, b] = pixel(x, y)
					if (r > 150 && r > g * 1.5 && r > b * 1.5) red++
				}
			}
			expect(red, `rounded border at ${left},${top}, selected=${selected}`).toBeGreaterThan(2)
		}
		for (const [x, y] of [
			[2, 2],
			[161, 2],
			[2, 161],
			[161, 161],
		]) {
			const [r, g, b] = pixel(x, y)
			expect(g > 200 && r < 50 && b < 50, `image clipped at ${x},${y}`).toBe(false)
		}
		const [red, green, blue] = pixel(82, 82)
		expect(red).toBeLessThanOrEqual(5)
		expect(green).toBeGreaterThanOrEqual(240)
		expect(blue).toBeLessThanOrEqual(5)
	}
	await dragWorld(page, { x: 280, y: 280 }, { x: 320, y: 320 })
	await expect.poll(async () => (await shapeOf(request, 'image')).x).not.toBe(200)
	await expect(image.locator('.selection')).toHaveCount(1)
})

test('narrow image clipping matches the border radii', async ({ page, request }) => {
	const shapes: CanvasShape[] = []
	for (const [width, height] of [
		[100, 10],
		[10, 100],
	]) {
		const png = await page.evaluate(
			([width, height]) => {
				const canvas = document.createElement('canvas')
				canvas.width = width
				canvas.height = height
				const context = canvas.getContext('2d')
				if (!context) throw new Error('Missing canvas context')
				context.fillStyle = '#00ff00'
				context.fillRect(0, 0, width, height)
				return canvas.toDataURL('image/png').split(',')[1]
			},
			[width, height],
		)
		const upload = await request.post('/api/images', {
			headers: { 'Content-Type': 'image/png' },
			data: Buffer.from(png, 'base64'),
		})
		expect(upload.ok()).toBe(true)
		const { id } = (await upload.json()) as { id: string }
		await page.evaluate(async (assetId) => {
			const image = new Image()
			image.src = `/api/images/${assetId}`
			await image.decode()
		}, id)
		shapes.push({
			id: `image-${width}-${height}`,
			type: 'image',
			imageId: id,
			x: width === 100 ? 200 : 400,
			y: 200,
			w: width,
			h: height,
			color: '#ff0000',
		})
	}
	await seed(page, request, shapes)
	for (const shape of shapes) {
		const image = page.locator(`[data-shape-id="${shape.id}"] .canvas-image`)
		await expect(image).toHaveCSS(
			'clip-path',
			`inset(0px round ${Math.min(10, shape.w / 2)}px / ${Math.min(10, shape.h / 2)}px)`,
		)
		await clickWorld(page, shape.x + shape.w / 2, shape.y + shape.h / 2)
		await expect(page.locator(`[data-shape-id="${shape.id}"] .selection`)).toHaveCount(1)
	}
})

test('image tool uploads a raster and frame background uses image shape identity', async ({
	page,
	request,
}) => {
	const chooserPromise = page.waitForEvent('filechooser')
	await page.getByRole('button', { name: 'Image', exact: true }).click()
	const chooser = await chooserPromise
	await chooser.setFiles({
		name: 'pixel.png',
		mimeType: 'image/png',
		buffer: Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
			'base64',
		),
	})

	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.type === 'image'))
		.toBeTruthy()
	const image = (await board(request)).shapes.find((shape) => shape.type === 'image')
	if (!image || image.type !== 'image' || !image.imageId)
		throw new Error('Missing uploaded image shape')
	await expect(page.locator(`[data-shape-id="${image.id}"] .canvas-image`)).toHaveCount(1)

	const current = await board(request)
	const frameResponse = await request.post('/api/operations', {
		data: {
			expectedRevision: current.revision,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'second-image',
						type: 'image',
						imageId: image.imageId,
						x: 1400,
						y: 320,
						w: 200,
						h: 200,
						color: CANDY_COLORS.blue,
					},
				},
				{
					type: 'create',
					shape: {
						id: 'image-frame',
						type: 'frame',
						x: 420,
						y: 320,
						w: 360,
						h: 280,
						color: CANDY_COLORS.blue,
						title: 'Image frame',
						backgroundImageId: image.id,
						backgroundFit: 'cover',
					},
				},
			],
		},
	})
	expect(frameResponse.ok()).toBe(true)

	await expect(page.locator('.frame-background-image')).toHaveCount(1)
	await resetView(page)
	const framePill = await pillBox(page, 'image-frame')
	await page.mouse.click(framePill.x + framePill.width / 2, framePill.y + framePill.height / 2)
	await expect(page.getByRole('region', { name: 'Selected object properties' })).toContainText(
		'Image frame',
	)
	let releaseFit!: () => void
	let markFitSent!: () => void
	const fitGate = new Promise<void>((resolve) => {
		releaseFit = resolve
	})
	const fitSent = new Promise<void>((resolve) => {
		markFitSent = resolve
	})
	await page.route('**/api/operations', async (route) => {
		const request = route.request()
		const body = request.method() === 'POST' ? request.postDataJSON() : null
		if (
			body?.operations?.some(
				(operation: { patch?: { backgroundFit?: string } }) =>
					operation.patch?.backgroundFit === 'contain',
			)
		) {
			markFitSent()
			await fitGate
		}
		await route.continue()
	})
	try {
		await page.getByRole('combobox', { name: 'Background fit' }).click()
		await page.keyboard.press('c')
		await expect(page.locator('[data-tool-id="select"] button')).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		await page.getByRole('option', { name: 'Contain', exact: true }).click()
		await expect(page.getByRole('region', { name: 'Selected object properties' })).toContainText(
			'Image frame',
		)
		await fitSent
		await choose(page, 'Background image', 'Image 2')
	} finally {
		releaseFit()
	}
	await expect
		.poll(async () => (await board(request)).shapes.find((shape) => shape.id === 'image-frame'))
		.toMatchObject({
			backgroundImageId: 'second-image',
			backgroundFit: 'contain',
		})
	await expect(page.locator('.frame-background-image')).toHaveAttribute(
		'preserveAspectRatio',
		'xMidYMid meet',
	)
	await page.getByRole('button', { name: 'Remove background', exact: true }).click()
	await expect(page.locator('.frame-background-image')).toHaveCount(0)
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
	const waitForOptions = async () => {
		await expect
			.poll(() =>
				page.locator('.tool-options-wrap').evaluate((element) => {
					const target = Number.parseFloat(
						(element as HTMLElement).style.getPropertyValue('--toolbar-options-width'),
					)
					return Math.abs(element.getBoundingClientRect().width - target)
				}),
			)
			.toBeLessThan(0.5)
	}
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await waitForOptions()
	await page.getByRole('button', { name: 'Neutral sticky' }).click()
	await expect(page.getByRole('button', { name: 'Neutral sticky' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await clickWorld(page, 500, 220)
	await expect.poll(async () => countOf(request, 'note')).toBe(1)
	expect((await board(request)).shapes.find((shape) => shape.type === 'note')).toMatchObject({
		color: CANDY_TINTS.neutral,
	})

	await page.getByRole('button', { name: 'Brush', exact: true }).click()
	await waitForOptions()
	await page.getByRole('button', { name: 'Brush style Pencil' }).click()
	await page.getByRole('button', { name: 'Brush width 2px' }).click()
	await dragWorld(page, { x: 200, y: 420 }, { x: 320, y: 480 })
	await expect.poll(async () => countOf(request, 'path')).toBe(1)
	expect((await board(request)).shapes.find((shape) => shape.type === 'path')).toMatchObject({
		brush: 'pencil',
		strokeWidth: 2,
	})
})

test('toolbar text selectors keep plain values and preview only in the menu', async ({ page }) => {
	await page.getByRole('button', { name: 'Text', exact: true }).click()
	const toolbar = page.getByRole('toolbar', { name: 'Canvas tools' })
	const family = toolbar.getByRole('combobox', { name: 'Font family' })
	const size = toolbar.getByRole('combobox', { name: 'Font size' })
	const weight = toolbar.getByRole('combobox', { name: 'Font weight' })

	await family.click()
	const hand = page.getByRole('option', { name: 'Hand', exact: true })
	await expect(hand.locator('span[style]')).toHaveCSS('font-family', /Bradley Hand/)
	await expect(hand.locator('span[style]')).toHaveCSS('font-size', '16px')
	await hand.click()

	await size.click()
	const large = page.getByRole('option', { name: '48', exact: true })
	await expect(large.locator('span[style]')).toHaveCSS('font-size', '48px')
	await large.click()

	await weight.click()
	const bold = page.getByRole('option', { name: '700', exact: true })
	await expect(bold.locator('span[style]')).toHaveCSS('font-weight', '700')
	await bold.click()

	for (const [trigger, value] of [
		[family, 'Hand'],
		[size, '48'],
		[weight, '700'],
	] as const) {
		await expect(trigger).toContainText(value)
		await expect(trigger).toHaveCSS('font-size', '12px')
		const styles = await trigger.evaluate((element) => {
			const inner = element.querySelector('.rt-SelectTriggerInner')
			if (!inner) throw new Error('Missing select value')
			const leaf =
				[...inner.querySelectorAll('*')].find((item) => item.children.length === 0) ?? inner
			const control = getComputedStyle(element)
			const selected = getComputedStyle(leaf)
			return {
				control: [control.fontFamily, control.fontSize, control.fontWeight],
				selected: [selected.fontFamily, selected.fontSize, selected.fontWeight],
			}
		})
		expect(styles.selected).toEqual(styles.control)
	}
})

test('toolbar text selectors keep chevrons small and selection checks clear of previews', async ({
	page,
}) => {
	await page.getByRole('button', { name: 'Text', exact: true }).click()
	const toolbar = page.getByRole('toolbar', { name: 'Canvas tools' })
	for (const label of ['Font family', 'Font size', 'Font weight']) {
		const trigger = toolbar.getByRole('combobox', { name: label })
		await expect(trigger.locator('.rt-SelectIcon')).toHaveCSS('width', '12px')
		await expect(trigger.locator('.rt-SelectIcon')).toHaveCSS('height', '12px')
		await trigger.click()
		const selected = page.locator('.select-item[data-state="checked"]')
		await expect(selected).toBeVisible()
		const check = await selected.locator('.rt-SelectItemIndicatorIcon').boundingBox()
		const text = await selected.locator('span[style]').boundingBox()
		if (!check || !text) throw new Error(`Missing selected option content for ${label}`)
		expect(check.x + check.width + 2).toBeLessThanOrEqual(text.x)
		const overflow = await page.locator('.select-item').evaluateAll((items) =>
			items.flatMap((item) => {
				const preview = item.querySelector('span[style]')
				if (!preview) return []
				const row = item.getBoundingClientRect()
				const text = preview.getBoundingClientRect()
				return text.top < row.top - 1 || text.bottom > row.bottom + 1 ? [item.textContent] : []
			}),
		)
		expect(overflow).toEqual([])
		await selected.click()
		if (label === 'Font size') {
			await trigger.click()
			await page.getByRole('option', { name: '48', exact: true }).click()
			await trigger.click()
			const large = page.locator('.select-item[data-state="checked"]')
			const largeCheck = await large.locator('.rt-SelectItemIndicatorIcon').boundingBox()
			const largeText = await large.locator('span[style]').boundingBox()
			if (!largeCheck || !largeText) throw new Error('Missing selected 48px option')
			expect(largeCheck.x + largeCheck.width + 2).toBeLessThanOrEqual(largeText.x)
			await large.click()
		}
	}
})

test('tool focus follows keyboard mode changes without stealing unrelated focus', async ({
	page,
}) => {
	const select = page.getByRole('button', { name: 'Select', exact: true })
	const pan = page.getByRole('button', { name: 'Pan', exact: true })
	const canvases = page.getByRole('button', { name: 'Canvases', exact: true })

	await select.focus()
	await page.keyboard.press('h')
	await expect(pan).toHaveAttribute('aria-pressed', 'true')
	await expect(pan).toBeFocused()
	await expect(select).not.toBeFocused()
	await expect(pan).toHaveCSS('outline-style', 'solid')

	await page.keyboard.press('v')
	await expect(select).toHaveAttribute('aria-pressed', 'true')
	await expect(select).toBeFocused()
	await expect(pan).not.toBeFocused()

	await page.keyboard.press('ArrowRight')
	await expect(pan).toBeFocused()
	await expect(select).toHaveAttribute('aria-pressed', 'true')
	await page.keyboard.press('v')
	await expect(select).toBeFocused()

	await canvases.focus()
	await page.keyboard.press('h')
	await expect(pan).toHaveAttribute('aria-pressed', 'true')
	await expect(canvases).toBeFocused()
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

test('identity, dock and panels use the reference glass geometry', async ({ page, request }) => {
	await seed(page, request, [rect('surface-rect', 200, 200, 200, 100)])
	await clickWorld(page, 300, 250)
	const properties = page.getByRole('region', { name: 'Selected object properties' })
	await expect(properties).toBeVisible()
	await expect(properties).toHaveClass(/floating-panel/)

	for (const [selector, radius] of [
		['.identity-panel', '22px'],
		['.toolbar-module', '24px'],
		['.selection-panel', '26px'],
		['.ai-panel', '30px'],
	] as const) {
		const panel = page.locator(selector)
		await expect(panel).toHaveCSS('border-radius', radius)
		await expect(panel).not.toHaveCSS('box-shadow', 'none')
	}
	for (const selector of ['.identity-panel', '.toolbar-module', '.selection-panel']) {
		await expect(page.locator(selector)).toHaveCSS('backdrop-filter', 'blur(22px) saturate(1.7)')
	}
	await expect(page.locator('.ai-panel')).toHaveCSS('backdrop-filter', 'blur(34px) saturate(1.8)')

	const idleToolBackgrounds = await page
		.locator('.drawing-tools .icon-button:not([aria-pressed="true"])')
		.evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).backgroundColor))
	expect(idleToolBackgrounds.length).toBeGreaterThan(0)
	for (const background of idleToolBackgrounds) expect(background).toBe('rgba(0, 0, 0, 0)')
})

test('properties icon is centered and the panel clears top surfaces at every width', async ({
	page,
	request,
}) => {
	await seed(page, request, [frame('geometry-frame', 200, 200, 400, 200)])
	const label = await pillBox(page, 'geometry-frame')
	await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2)

	const properties = page.getByRole('region', { name: 'Selected object properties' })
	await expect(properties).toBeVisible()
	await expect(properties.getByLabel('Frame title')).toHaveValue('geometry-frame')
	const icon = await properties.locator('.selection-icon').boundingBox()
	const iconGlyph = await properties.locator('.selection-icon svg').boundingBox()
	if (!icon || !iconGlyph) throw new Error('Expected centered properties icon geometry')
	expect(iconGlyph.x + iconGlyph.width / 2).toBeCloseTo(icon.x + icon.width / 2, 5)
	expect(iconGlyph.y + iconGlyph.height / 2).toBeCloseTo(icon.y + icon.height / 2, 5)

	await page.setViewportSize({ width: 1440, height: 960 })
	const aiPanel = page.locator('#ai-panel')
	const aiTrigger = page.locator('.ai-assistant .ai-trigger')
	const identity = page.locator('.identity-panel')
	const closedTrigger = await aiTrigger.boundingBox()
	const closedIdentity = await identity.boundingBox()
	const closedProperties = await properties.boundingBox()
	const closedAi = await aiPanel.boundingBox()
	if (!closedTrigger || !closedIdentity || !closedProperties || !closedAi)
		throw new Error('Expected desktop surface geometry')
	expect(closedProperties.y).toBeCloseTo(closedAi.y, 5)
	expect(closedProperties.x + closedProperties.width).toBeLessThan(closedTrigger.x)
	expect(closedProperties.x).toBeGreaterThan(closedIdentity.x + closedIdentity.width)

	await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click()
	await expect(page.locator('#ai-panel')).toHaveClass(/is-open/)
	const openProperties = await properties.boundingBox()
	const openAi = await aiPanel.boundingBox()
	const openTrigger = await aiTrigger.boundingBox()
	if (!openProperties || !openAi || !openTrigger)
		throw new Error('Expected open desktop surface geometry')
	expect(openProperties.y).toBeCloseTo(openAi.y, 5)
	expect(openAi.x - (openProperties.x + openProperties.width)).toBeGreaterThanOrEqual(16)
	expect(openTrigger.x).toBeGreaterThan(openProperties.x + openProperties.width)
	expect(openProperties.x).toBeGreaterThan(closedIdentity.x + closedIdentity.width)

	await page.getByRole('button', { name: 'Close AI assistant', exact: true }).click()
	for (const width of [360, 390, 768, 769]) {
		await page.setViewportSize({ width, height: 844 })
		await page.mouse.move(0, 0)
		const dock = await page.getByRole('toolbar').boundingBox()
		const panel = await properties.boundingBox()
		const trigger = await aiTrigger.boundingBox()
		const brand = await identity.boundingBox()
		if (!dock || !panel || !trigger || !brand)
			throw new Error(`Expected responsive geometry at ${width}px`)
		expect(panel.x).toBeGreaterThanOrEqual(0)
		expect(panel.x + panel.width).toBeLessThanOrEqual(width)
		if (width <= 768) {
			expect(panel.y).toBeGreaterThanOrEqual(0)
			expect(panel.y + panel.height).toBeLessThanOrEqual(dock.y)
			expect(panel.y >= trigger.y + trigger.height || trigger.y >= panel.y + panel.height).toBe(
				true,
			)
			expect(panel.y >= brand.y + brand.height || brand.y >= panel.y + panel.height).toBe(true)
		} else {
			expect(panel.x + panel.width).toBeLessThan(trigger.x)
		}
	}

	await page.setViewportSize({ width: 769, height: 844 })
	await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click()
	await expect(properties).toBeVisible()
	const narrowProperties = await properties.boundingBox()
	const narrowIdentity = await identity.boundingBox()
	const narrowAi = await aiPanel.boundingBox()
	const narrowDock = await page.getByRole('toolbar').boundingBox()
	if (!narrowProperties || !narrowIdentity || !narrowAi || !narrowDock)
		throw new Error('Expected narrow desktop surface geometry')
	expect(narrowProperties.y).toBeGreaterThanOrEqual(narrowIdentity.y + narrowIdentity.height)
	expect(narrowProperties.x + narrowProperties.width).toBeLessThanOrEqual(narrowAi.x)
	expect(narrowProperties.y + narrowProperties.height).toBeLessThanOrEqual(narrowDock.y)

	await page.setViewportSize({ width: 390, height: 844 })
	await expect(properties).not.toBeVisible()
	await expect(aiPanel).toBeVisible()
	await page.locator('#ai-panel, .ai-trigger, .identity-panel').evaluateAll(async (elements) => {
		await Promise.all(
			elements
				.flatMap((element) => element.getAnimations())
				.map((animation) => animation.finished.catch(() => undefined)),
		)
	})
	await expect
		.poll(async () => {
			const panel = await aiPanel.boundingBox()
			const trigger = await aiTrigger.boundingBox()
			return panel && trigger ? { panelX: panel.x, triggerX: trigger.x } : null
		})
		.toEqual({ panelX: 14, triggerX: 332 })
	const mobileAi = await aiPanel.boundingBox()
	const mobileTrigger = await aiTrigger.boundingBox()
	const mobileIdentity = await identity.boundingBox()
	if (!mobileAi || !mobileTrigger || !mobileIdentity)
		throw new Error('Expected mobile open geometry')
	expect(mobileAi).toEqual({ x: 14, y: 14, width: 362, height: 816 })
	expect(mobileTrigger).toEqual({ x: 332, y: 24, width: 34, height: 34 })
	expect(mobileIdentity).toEqual({ x: 14, y: 14, width: 100, height: 56 })
	expect(mobileTrigger.x).toBeGreaterThan(mobileAi.x)
	expect(mobileTrigger.y).toBeLessThan(mobileAi.y + mobileAi.height)
	expect(mobileIdentity.x + mobileIdentity.width).toBeLessThan(mobileTrigger.x)
	const triggerClickable = await page.evaluate(
		({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-ai-toggle="true"]')),
		{ x: mobileTrigger.x + mobileTrigger.width / 2, y: mobileTrigger.y + mobileTrigger.height / 2 },
	)
	expect(triggerClickable).toBe(true)
})
