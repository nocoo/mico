import { type APIRequestContext, expect, type Page } from '@playwright/test'
import type { Board, CanvasShape, Shape } from '../../src/shared/types'

export const ISOLATED_ORIGIN = 'http://127.0.0.1:27063'

export async function board(request: APIRequestContext): Promise<Board> {
	const response = await request.get('/api/board')
	expect(response.ok()).toBe(true)
	return response.json()
}

export async function resetBoard(request: APIRequestContext, shapes: Shape[] = []): Promise<Board> {
	const current = await board(request)
	const response = await request.post('/api/operations', {
		data: {
			expectedRevision: current.revision,
			operations: [
				...current.shapes.map((shape) => ({ type: 'delete', id: shape.id })),
				...shapes.map((shape) => ({ type: 'create', shape })),
			],
		},
	})
	expect(response.ok()).toBe(true)
	return response.json()
}

export async function shapeOf(request: APIRequestContext, id: string): Promise<CanvasShape> {
	const shape = (await board(request)).shapes.find((candidate) => candidate.id === id)
	if (!shape || shape.type === 'connector') throw new Error(`Missing canvas shape ${id}`)
	return shape
}

export async function choose(page: Page, label: string, option: string) {
	await page.getByRole('combobox', { name: label, exact: true }).click()
	await page.getByRole('option', { name: option, exact: true }).click()
}

export async function worldView(page: Page) {
	return page.locator('[data-world-layer]').evaluate((element) => {
		const matrix = (element as SVGGElement).transform.baseVal.consolidate()?.matrix
		if (!matrix) throw new Error('Missing world transform')
		return { x: matrix.e, y: matrix.f, zoom: matrix.a }
	})
}

export async function worldPoint(page: Page, x: number, y: number) {
	const view = await worldView(page)
	return { x: view.x + x * view.zoom, y: view.y + y * view.zoom }
}

export async function worldScale(page: Page): Promise<number> {
	return (await worldView(page)).zoom
}

export async function resetView(page: Page) {
	await page.getByRole('button', { name: 'Reset view' }).click()
}

export async function dragWorld(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	steps = 8,
) {
	const start = await worldPoint(page, from.x, from.y)
	const end = await worldPoint(page, to.x, to.y)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps })
	await page.mouse.up()
}

export async function clickWorld(page: Page, x: number, y: number) {
	const point = await worldPoint(page, x, y)
	await page.mouse.click(point.x, point.y)
}

export async function pillBox(page: Page, id: string) {
	const box = await page.locator(`[data-card-handle="${id}"] .card-pill`).boundingBox()
	if (!box) throw new Error(`Missing label for ${id}`)
	return box
}

export async function clickPathInk(page: Page, id: string) {
	const point = await page
		.locator(`[data-shape-id="${id}"] path`)
		.first()
		.evaluate((element) => {
			const shape = element as SVGPathElement
			const local = shape.getPointAtLength(shape.getTotalLength() / 2)
			const screen = new DOMPoint(local.x, local.y).matrixTransform(
				shape.getScreenCTM() ?? undefined,
			)
			return { x: screen.x, y: screen.y }
		})
	await page.mouse.click(point.x, point.y)
}

export const colors = {
	blue: '#3b82f6',
	green: '#22c55e',
	yellow: '#facc15',
	pink: '#f472b6',
	ink: '#263248',
	noteYellow: '#fef3c7',
}
