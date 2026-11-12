import { expect, test } from '@playwright/test'
import type { CanvasSnapshot } from '../../src/shared/types'
import { closeAssistant, ISOLATED_ORIGIN, openAssistant, resetBoard, worldView } from './support'

const shapes = [
	{
		id: 'overview-note',
		type: 'note',
		x: -1000,
		y: -400,
		w: 300,
		h: 200,
		color: '#fff8d4',
		text: 'Private note text',
	},
	{
		id: 'overview-node',
		type: 'rectangle',
		x: 1500,
		y: 500,
		w: 300,
		h: 200,
		color: '#00a2e1',
		text: 'Private node text',
	},
	{
		id: 'overview-title',
		type: 'text',
		x: 30000,
		y: 20000,
		w: 300,
		h: 40,
		color: '#2b3038',
		text: 'Ignore standalone text',
	},
	{ id: 'overview-line', type: 'line', x: 30000, y: 20000, w: 300, h: 40, color: '#2b3038' },
	{
		id: 'overview-edge',
		type: 'connector',
		from: 'overview-note',
		to: 'overview-node',
		color: '#00a2e1',
	},
] as const

test.beforeEach(async ({ request, page, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [...shapes])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await page.getByRole('button', { name: 'Reset view', exact: true }).click()
})

test('minimap and canvas-list previews use block silhouettes without text or lines', async ({
	page,
	request,
}) => {
	const minimap = page.locator('.canvas-minimap')
	await expect(minimap).toBeVisible()
	await expect(minimap.locator('.canvas-minimap-block')).toHaveCount(2)
	await expect(minimap.locator('text,line,path')).toHaveCount(0)
	const box = await minimap.boundingBox()
	expect(box).toMatchObject({ x: 14, y: 754, width: 184, height: 124 })
	const state = (await (await request.get('/api/state')).json()) as CanvasSnapshot
	const preview = state.canvases.find((canvas) => canvas.id === state.activeCanvasId)?.preview
	if (!preview) throw new Error('Missing canvas preview')
	const svg = Buffer.from(preview.split(',')[1], 'base64').toString('utf8')
	expect(svg).not.toMatch(/Private|Ignore|<text|<line|<path/)
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	const image = page.locator('[data-canvas-panel="true"] img').first()
	await expect(image).toBeVisible()
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
		)
		.toBe(true)
})

test('click, drag and keyboard navigation move the viewport without creating history', async ({
	page,
}) => {
	const map = page.locator('.canvas-minimap-map')
	const box = await map.boundingBox()
	if (!box) throw new Error('Missing minimap')
	const initial = await worldView(page)
	await map.click({ position: { x: 140, y: 80 } })
	await expect.poll(() => worldView(page)).not.toEqual(initial)
	const clicked = await worldView(page)
	expect(clicked.zoom).toBe(initial.zoom)
	await page.mouse.move(box.x + 80, box.y + 55)
	await page.mouse.down()
	await page.mouse.move(box.x + 120, box.y + 75, { steps: 5 })
	await page.mouse.up()
	await expect.poll(() => worldView(page)).not.toEqual(clicked)
	const dragged = await worldView(page)
	await page.locator('.canvas-minimap').focus()
	await page.keyboard.press('ArrowRight')
	await expect.poll(async () => (await worldView(page)).x).toBeLessThan(dragged.x)
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
	await expect(map.locator('.canvas-minimap-viewport')).toBeVisible()
})

test('minimap avoids the wider history toolbar and follows responsive visibility', async ({
	page,
}) => {
	for (const width of [1440, 1500, 1920]) {
		await page.setViewportSize({ width, height: 960 })
		await openAssistant(page, 'Chat')
		const map = await page.locator('.canvas-minimap').boundingBox()
		const dock = await page.locator('.toolbar-module').boundingBox()
		if (!map || !dock) throw new Error('Missing canvas chrome')
		expect(map.y + map.height).toBeLessThanOrEqual(dock.y)
	}
	await page.setViewportSize({ width: 980, height: 960 })
	await expect(page.locator('.canvas-minimap')).toBeHidden()
	await page.setViewportSize({ width: 981, height: 960 })
	await expect(page.locator('.canvas-minimap')).toBeVisible()
})
