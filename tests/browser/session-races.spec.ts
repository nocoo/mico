import { type APIRequestContext, expect, type Page, type Route, test } from '@playwright/test'
import type { CanvasDetail, CanvasSnapshot } from '../../src/shared/types'
import { closeAssistant, ISOLATED_ORIGIN } from './support'

const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
)
const POLL = { timeout: 5000, intervals: [25, 50, 100, 250] }

function gate() {
	let release!: () => void
	const promise = new Promise<void>((resolve) => {
		release = resolve
	})
	return { promise, release }
}

async function snapshot(request: APIRequestContext): Promise<CanvasSnapshot> {
	const response = await request.get('/api/state')
	expect(response.ok()).toBe(true)
	return response.json()
}

async function resetCanvases(request: APIRequestContext) {
	const current = await snapshot(request)
	const keep = current.canvases[0]
	const activated = await request.put('/api/active-canvas', { data: { id: keep.id } })
	expect(activated.ok()).toBe(true)
	for (const canvas of current.canvases.slice(1)) {
		const removed = await request.delete(`/api/canvases/${canvas.id}`)
		expect(removed.ok()).toBe(true)
	}
	const renamed = await request.patch(`/api/canvases/${keep.id}`, {
		data: { name: 'Race A' },
	})
	expect(renamed.ok()).toBe(true)
	const active = await snapshot(request)
	const cleared = await request.post('/api/operations', {
		data: {
			expectedRevision: active.board.revision,
			operations: active.board.shapes.map((shape) => ({ type: 'delete', id: shape.id })),
		},
	})
	expect(cleared.ok()).toBe(true)
	return snapshot(request)
}

async function createRaceCanvases(request: APIRequestContext) {
	const initial = await snapshot(request)
	const response = await request.post('/api/canvases', {
		data: { name: 'Race B', activate: false },
	})
	expect(response.ok()).toBe(true)
	const created = (await response.json()) as CanvasSnapshot & { createdCanvasId: string }
	return { firstId: initial.activeCanvasId, secondId: created.createdCanvasId }
}

async function openCanvas(page: Page) {
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
}

async function installDimensionGate(page: Page) {
	await page.addInitScript(() => {
		const original = globalThis.createImageBitmap.bind(globalThis)
		let release!: () => void
		const dimensions = new Promise<void>((resolve) => {
			release = resolve
		})
		const state = { calls: 0, release }
		Object.assign(globalThis, { __micoImageDimensionGate: state })
		globalThis.createImageBitmap = ((...args: unknown[]) => {
			state.calls += 1
			return dimensions.then(() => Reflect.apply(original, globalThis, args))
		}) as typeof createImageBitmap
	})
}

async function dimensionCalls(page: Page) {
	return page.evaluate(() => {
		const state = (
			globalThis as typeof globalThis & {
				__micoImageDimensionGate: { calls: number; release: () => void }
			}
		).__micoImageDimensionGate
		return state.calls
	})
}

async function releaseDimensions(page: Page) {
	await page.evaluate(() => {
		const state = (
			globalThis as typeof globalThis & {
				__micoImageDimensionGate: { calls: number; release: () => void }
			}
		).__micoImageDimensionGate
		state.release()
	})
}

async function imageShapeCount(request: APIRequestContext, canvasIds: string[]) {
	let count = 0
	for (const canvasId of canvasIds) {
		const response = await request.get(`/api/canvases/${canvasId}`)
		expect(response.ok()).toBe(true)
		const detail = (await response.json()) as CanvasDetail
		count += detail.board.shapes.filter((shape) => shape.type === 'image').length
	}
	return count
}

async function uploadTinyPng(page: Page) {
	await page.getByLabel('Choose image').setInputFiles({
		name: 'race.png',
		mimeType: 'image/png',
		buffer: TINY_PNG,
	})
}

test.beforeEach(async ({ request, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetCanvases(request)
})

test.afterEach(async ({ page, request, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await page.unrouteAll({ behavior: 'ignoreErrors' })
	await resetCanvases(request)
})

test('view updates keep one canvas subscription under StrictMode', async ({ page }) => {
	let sockets = 0
	let polls = 0
	page.on('websocket', (socket) => {
		if (new URL(socket.url()).pathname === '/api/events') sockets++
	})
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/api/state' && new URL(request.url()).search) polls++
	})
	await openCanvas(page)
	await expect.poll(() => sockets, POLL).toBe(1)
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await expect.poll(() => polls, { timeout: 6000 }).toBeGreaterThan(0)
	expect(sockets).toBe(1)
})

test('cancels a dimension-pending image upload when a canvas switch is only requested', async ({
	page,
	request,
}) => {
	const { firstId, secondId } = await createRaceCanvases(request)
	await installDimensionGate(page)
	await openCanvas(page)

	const switchGate = gate()
	let imagePosts = 0
	let heldSwitch: Route | undefined
	try {
		await page.route('**/api/images', async (route) => {
			if (route.request().method() === 'POST') imagePosts += 1
			await route.abort('failed')
		})
		await uploadTinyPng(page)
		await expect.poll(() => dimensionCalls(page), POLL).toBe(1)

		await page.route('**/api/active-canvas', async (route) => {
			heldSwitch = route
			await switchGate.promise
			await route.continue()
		})
		await page.getByRole('button', { name: 'Canvases', exact: true }).click()
		await page.getByRole('button', { name: 'Open canvas Race B', exact: true }).click()
		await expect.poll(() => Boolean(heldSwitch), POLL).toBe(true)
		expect(heldSwitch?.request().postDataJSON()).toEqual({ id: secondId })
		await expect.poll(async () => (await snapshot(request)).activeCanvasId, POLL).toBe(firstId)
		await expect(
			page.getByRole('button', { name: 'Open canvas Race A', exact: true }),
		).toHaveAttribute('aria-current', 'true')

		await releaseDimensions(page)
		await expect(page.locator('.notice')).toContainText(
			'Image upload canceled because the canvas changed',
		)
		expect(imagePosts).toBe(0)
		await expect.poll(() => imageShapeCount(request, [firstId, secondId]), POLL).toBe(0)
	} finally {
		await releaseDimensions(page)
		switchGate.release()
		await page.unrouteAll({ behavior: 'ignoreErrors' })
	}
	await expect.poll(async () => (await snapshot(request)).activeCanvasId, POLL).toBe(secondId)
	await expect.poll(() => imageShapeCount(request, [firstId, secondId]), POLL).toBe(0)
})

test('ignores an upload response that arrives after the active canvas changes', async ({
	page,
	request,
}) => {
	const { firstId, secondId } = await createRaceCanvases(request)
	await openCanvas(page)

	const uploadGate = gate()
	let heldUpload = 0
	try {
		await page.route('**/api/images', async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue()
				return
			}
			const response = await route.fetch()
			heldUpload += 1
			await uploadGate.promise
			await route.fulfill({ response })
		})
		await uploadTinyPng(page)
		await expect.poll(() => heldUpload, POLL).toBe(1)
		await expect.poll(async () => (await snapshot(request)).activeCanvasId, POLL).toBe(firstId)

		await page.getByRole('button', { name: 'Canvases', exact: true }).click()
		await page.getByRole('button', { name: 'Open canvas Race B', exact: true }).click()
		await expect.poll(async () => (await snapshot(request)).activeCanvasId, POLL).toBe(secondId)
		await expect(page.locator('.canvas-image')).toHaveCount(0)

		uploadGate.release()
		await expect(page.locator('.notice')).toContainText('Image uploaded, but the canvas changed')
		await expect.poll(() => imageShapeCount(request, [firstId, secondId]), POLL).toBe(0)
		await expect(page.locator('.canvas-image')).toHaveCount(0)
	} finally {
		uploadGate.release()
		await page.unrouteAll({ behavior: 'ignoreErrors' })
	}
})
