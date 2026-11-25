import { type APIRequestContext, expect, test } from '@playwright/test'
import type { CanvasSnapshot } from '../../src/shared/types'
import { clickWorld, closeAssistant, ISOLATED_ORIGIN, resetBoard, resetView } from './support'

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

test.beforeEach(async ({ page, request, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetCanvases(request)
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await resetView(page)
})

test.afterEach(async ({ request }) => {
	await resetCanvases(request)
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
	await closeAssistant(page)
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
	const editingItem = panel.locator('.canvas-item.editing')
	await expect(editingItem).toHaveCount(1)
	await expect(editingItem.locator('.canvas-actions')).toBeHidden()
	await nameInput.fill('A long canvas name that should remain editable')
	const inputEndIsClickable = await nameInput.evaluate((input) => {
		const box = input.getBoundingClientRect()
		return document.elementFromPoint(box.right - 4, box.y + box.height / 2) === input
	})
	expect(inputEndIsClickable).toBe(true)
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
	await panel.getByRole('button', { name: 'Rename Second canvas', exact: true }).click()
	await expect(editingItem).toHaveCount(1)
	await expect(editingItem.locator('.canvas-actions')).toBeHidden()
	const secondInput = panel.getByLabel('Canvas name')
	await secondInput.fill('A long inactive canvas name')
	expect(
		await secondInput.evaluate((input) => {
			const box = input.getBoundingClientRect()
			return document.elementFromPoint(box.right - 4, box.y + box.height / 2) === input
		}),
	).toBe(true)
	await secondInput.press('Escape')
	await expect(panel.getByRole('button', { name: 'Open canvas Second canvas' })).toBeVisible()
	await secondItem.hover()
	await panel.getByRole('button', { name: 'Delete Second canvas', exact: true }).click()
	await panel.getByRole('button', { name: 'Confirm delete Second canvas', exact: true }).click()
	await expect.poll(async () => (await state(request)).canvases.length).toBe(1)
	await expect(panel.locator('.canvas-item')).toHaveCount(1)
	await expect(
		panel.getByRole('button', { name: 'Delete Renamed canvas', exact: true }),
	).toBeDisabled()
})
