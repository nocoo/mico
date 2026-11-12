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

test('foreign changes are not history and unrelated changes survive undo', async ({
	page,
	request,
}) => {
	await dragWorld(page, { x: 350, y: 280 }, { x: 430, y: 360 })
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	const foreign = { ...note, id: 'foreign-note', x: 700, text: 'Agent content' }
	await request.post('/api/operations', {
		data: { operations: [{ type: 'create', shape: foreign }] },
	})
	await expect(page.locator('[data-shape-id="foreign-note"]')).toBeVisible()
	await page.getByRole('button', { name: 'Undo', exact: true }).click()
	await expect.poll(async () => (await board(request)).shapes).toEqual([note, foreign])
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
	await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
	await page.keyboard.press('Control+Shift+z')
	await expect
		.poll(async () => (await board(request)).shapes.find((s) => s.id === note.id))
		.not.toEqual(note)
	await request.post('/api/operations', {
		data: { operations: [{ type: 'update', id: note.id, patch: { text: 'Agent changed it' } }] },
	})
	await expect(page.locator(`[data-shape-id="${note.id}"]`)).toContainText('Agent changed it')
	const before = await board(request)
	await page.getByRole('button', { name: 'Undo', exact: true }).click()
	await expect(page.locator('.notice')).toContainText('changed elsewhere')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	expect(await board(request)).toEqual(before)
})

test('history survives canvas switches but is cleared by reload', async ({ page, request }) => {
	const initial = await (await request.get('/api/state')).json()
	await dragWorld(page, { x: 350, y: 280 }, { x: 430, y: 360 })
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	const created = await (
		await request.post('/api/canvases', { data: { name: 'History isolation', activate: true } })
	).json()
	await expect(page).toHaveTitle('mico · History isolation')
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
	await request.put('/api/active-canvas', { data: { id: initial.activeCanvasId } })
	await expect(page.locator(`[data-shape-id="${note.id}"]`)).toBeVisible()
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	await page.getByRole('button', { name: 'Undo', exact: true }).click()
	await expect.poll(async () => (await board(request)).shapes).toEqual([note])
	await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
	await page.reload()
	await closeAssistant(page)
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
	await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
	await request.delete(`/api/canvases/${created.createdCanvasId}`)
})

test('an HTTP rejection does not consume undo and a retry remains possible', async ({
	page,
	request,
}) => {
	await dragWorld(page, { x: 350, y: 280 }, { x: 430, y: 360 })
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	const before = await board(request)
	await page.route(
		'**/api/operations',
		(route) =>
			route.fulfill({
				status: 409,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'REVISION_CONFLICT', message: 'Concurrent edit' }),
			}),
		{ times: 1 },
	)
	await page.getByRole('button', { name: 'Undo', exact: true }).click()
	await expect(page.locator('.notice')).toContainText('HTTP 409')
	expect(await board(request)).toEqual(before)
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	await page.getByRole('button', { name: 'Undo', exact: true }).click()
	await expect.poll(async () => (await board(request)).shapes).toEqual([note])
})

test('a committed undo survives a lost HTTP response and later unrelated edits', async ({
	page,
	request,
}) => {
	await dragWorld(page, { x: 350, y: 280 }, { x: 430, y: 360 })
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	const first = (await board(request)).shapes
	await dragWorld(page, { x: 430, y: 360 }, { x: 510, y: 440 })
	await expect.poll(async () => (await board(request)).shapes).not.toEqual(first)
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	const foreign = { ...note, id: 'foreign-after-undo', x: 700 }
	await page.route(
		'**/api/operations',
		async (route) => {
			const response = await route.fetch()
			expect(response.ok()).toBe(true)
			await request.post('/api/operations', {
				data: { operations: [{ type: 'create', shape: foreign }] },
			})
			await expect(page.locator('[data-shape-id="foreign-after-undo"]')).toBeVisible()
			await route.abort('connectionreset')
		},
		{ times: 1 },
	)
	await page.getByRole('button', { name: 'Undo', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
	await expect.poll(async () => (await board(request)).shapes).toEqual([...first, foreign])
	await page.getByRole('button', { name: 'Undo', exact: true }).click()
	await expect.poll(async () => (await board(request)).shapes).toEqual([note, foreign])
})

test('text editors keep native undo instead of undoing the board', async ({ page, request }) => {
	await dragWorld(page, { x: 350, y: 280 }, { x: 430, y: 360 })
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
	const current = await board(request)
	const field = page
		.getByRole('region', { name: 'Selected object properties' })
		.getByLabel('Text', { exact: true })
	await field.click()
	await field.press('End')
	await field.pressSequentially(' draft')
	await field.press('Control+z')
	expect(await board(request)).toEqual(current)
})
