import { expect, test } from '@playwright/test'
import { board, closeAssistant, dragWorld, ISOLATED_ORIGIN, resetBoard, resetView } from './support'

const note = {
	id: 'history-note',
	type: 'note',
	x: 300,
	y: 240,
	w: 200,
	h: 130,
	color: '#fff8d4',
	text: 'Original',
} as const

test.beforeEach(async ({ request, page, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [note])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await resetView(page)
})

test('toolbar undo and redo restore a completed drag and ignore viewport navigation', async ({
	page,
	request,
}) => {
	const undo = page.getByRole('button', { name: 'Undo', exact: true })
	const redo = page.getByRole('button', { name: 'Redo', exact: true })
	await expect(undo).toBeDisabled()
	await expect(redo).toBeDisabled()
	await dragWorld(page, { x: 350, y: 280 }, { x: 430, y: 360 })
	await expect
		.poll(async () => (await board(request)).shapes.find((s) => s.id === note.id))
		.not.toEqual(note)
	const moved = (await board(request)).shapes
	await expect(undo).toBeEnabled()
	await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
	await undo.click()
	await expect.poll(async () => (await board(request)).shapes).toEqual([note])
	await expect(undo).toBeDisabled()
	await expect(redo).toBeEnabled()
	await redo.click()
	await expect.poll(async () => (await board(request)).shapes).toEqual(moved)
	await expect(redo).toBeDisabled()
})

test('delete undo restores connectors and a new edit clears redo', async ({ page, request }) => {
	const other = { ...note, id: 'history-other', x: 650 }
	const edge = {
		id: 'history-edge',
		type: 'connector',
		from: note.id,
		to: other.id,
		color: '#00a2e1',
	} as const
	await resetBoard(request, [note, other, edge])
	await expect(page.locator('[data-shape-id="history-edge"]')).toBeVisible()
	await page.locator(`[data-shape-id="${note.id}"]`).click()
	await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
	await expect.poll(async () => (await board(request)).shapes).toEqual([other])
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	await page.keyboard.press('Control+z')
	await expect.poll(async () => (await board(request)).shapes).toEqual([note, other, edge])
	await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
	await dragWorld(page, { x: 350, y: 280 }, { x: 430, y: 360 })
	await expect
		.poll(async () => (await board(request)).shapes.find((s) => s.id === note.id))
		.not.toEqual(note)
	await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
})
