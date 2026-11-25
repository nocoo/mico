import { expect, test } from '@playwright/test'
import { board, ISOLATED_ORIGIN, resetBoard } from './support'

test.beforeEach(({ baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to use a non-isolated whiteboard')
})

test('demo presenters can draw, create and switch canvases while retaining their profile', async ({
	page,
	request,
}) => {
	await resetBoard(request, [])
	await page.route('/api/runtime', (route) =>
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
	await page.goto('/?sharer=true')
	await expect(page.locator('.whiteboard-cursors')).toHaveCount(1)
	await expect(page.getByRole('button', { name: 'Workspace profile' })).toBeVisible()
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await page.mouse.click(500, 400)
	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'note'))
		.toBe(true)
	const initial = await (await request.get('/api/state')).json()
	const original = initial.canvases.find(
		(canvas: { id: string }) => canvas.id === initial.activeCanvasId,
	)
	const noteId = initial.board.shapes.find((shape: { type: string }) => shape.type === 'note').id
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await page.getByRole('button', { name: 'New canvas', exact: true }).click()
	await expect
		.poll(async () => (await (await request.get('/api/state')).json()).activeCanvasId)
		.not.toBe(initial.activeCanvasId)
	const created = await (await request.get('/api/state')).json()
	expect(created.canvases).toHaveLength(initial.canvases.length + 1)
	expect(created.board.shapes).toHaveLength(0)
	await expect(page.getByRole('button', { name: 'Workspace profile' })).toBeVisible()

	await page.getByRole('button', { name: `Open canvas ${original.name}`, exact: true }).click()
	await expect(page.locator(`[data-shape-id="${noteId}"]`)).toHaveCount(1)
	await page.reload()
	await expect(page.locator(`[data-shape-id="${noteId}"]`)).toHaveCount(1)
	await expect(page.getByRole('button', { name: 'Workspace profile' })).toBeVisible()
	expect((await request.delete(`/api/canvases/${created.activeCanvasId}`)).ok()).toBe(true)
})

test('demo guests see the server hint when canvas creation or switching is rejected', async ({
	page,
	request,
}) => {
	await resetBoard(request, [])
	const createdResponse = await request.post('/api/canvases', {
		data: { name: 'Presenter canvas', activate: false },
	})
	expect(createdResponse.ok()).toBe(true)
	const created = await createdResponse.json()
	try {
		await page.route('/api/runtime', async (route) => {
			const response = await route.fetch()
			await route.fulfill({
				json: { ...(await response.json()), auth: { mode: 'demo' }, aiEnabled: false },
			})
		})
		const hint =
			'Only the presenter can create or change demo canvases. Use Workspace profile to become or request presenter.'
		const tokens: string[] = []
		for (const path of ['/api/canvases', '/api/active-canvas']) {
			await page.route(path, async (route) => {
				if (route.request().method() === 'GET') return route.continue()
				tokens.push(route.request().headers()['x-mico-whiteboard'] ?? '')
				await route.fulfill({
					status: 403,
					json: { error: 'WHITEBOARD_READ_ONLY', message: hint },
				})
			})
		}
		await page.goto('/')
		await expect(page.locator('.whiteboard-cursors')).toHaveCount(1)
		await page.getByRole('button', { name: 'Canvases', exact: true }).click()
		await page.getByRole('button', { name: 'New canvas', exact: true }).click()
		await expect(page.getByRole('status')).toHaveText(hint)
		await expect(page.getByRole('status')).toHaveCount(0)
		await page.getByRole('button', { name: 'Open canvas Presenter canvas', exact: true }).click()
		await expect(page.getByRole('status')).toHaveText(hint)
		const unchanged = await (await request.get('/api/state')).json()
		expect(unchanged.activeCanvasId).toBe(created.activeCanvasId)
		expect(unchanged.canvases).toHaveLength(created.canvases.length)
		expect(tokens).toHaveLength(2)
		expect(tokens.every((token) => token.length > 0)).toBe(true)
		await page.keyboard.press('Escape')
		await page.getByLabel('Choose image', { exact: true }).setInputFiles({
			name: 'pixel.png',
			mimeType: 'image/png',
			buffer: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
				'base64',
			),
		})
		await expect
			.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'image'))
			.toBe(true)
	} finally {
		expect((await request.delete(`/api/canvases/${created.createdCanvasId}`)).ok()).toBe(true)
	}
})
