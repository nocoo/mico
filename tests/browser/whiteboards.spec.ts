import { expect, type Page, test } from '@playwright/test'
import {
	closeAssistant,
	ISOLATED_ORIGIN,
	installMicrophoneMock,
	mockMaiTranscription,
	openAssistant,
} from './support'

async function view(page: Page) {
	return page.locator('[data-world-layer]').evaluate((node) => {
		const transform = (node as SVGGElement).transform.baseVal.consolidate()?.matrix
		const bounds = node.closest('svg')?.getBoundingClientRect()
		if (!transform || !bounds) throw new Error('Canvas viewport missing')
		return {
			centerX: (bounds.width / 2 - transform.e) / transform.a,
			centerY: (bounds.height / 2 - transform.f) / transform.a,
			zoom: transform.a,
		}
	})
}

test.beforeEach(({ baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to use a non-isolated whiteboard')
})

test('create, join, shared cursors, presenter edits and independent/following views', async ({
	page: presenter,
	context,
	request,
}, testInfo) => {
	test.setTimeout(45000)
	await presenter.goto('/?whiteboards=1')
	await presenter.getByLabel('Your name', { exact: true }).fill('Jason Huang')
	await presenter.getByLabel('New whiteboard name').fill('Browser collaboration')
	await presenter.getByRole('button', { name: 'Create and present' }).click()
	await expect(presenter.locator('.whiteboard-presence')).toContainText('Presenting')
	await expect(presenter.locator('.whiteboard-members')).toContainText('Jason Huang')
	await closeAssistant(presenter)
	const query = new URL(presenter.url()).searchParams
	const id = query.get('whiteboardid')
	expect(id).toBeTruthy()
	const viewer = await context.newPage()
	await viewer.setViewportSize({ width: 1100, height: 800 })
	await viewer.goto(
		`/?${new URLSearchParams({ whiteboardid: id ?? '', username: 'Alice Chen', sharer: 'false' })}`,
	)
	await expect(viewer.locator('.whiteboard-members')).toContainText('Jason Huang')
	await expect(presenter.locator('.whiteboard-members')).toContainText('Alice Chen')
	await expect(viewer.getByRole('button', { name: 'Sticky note', exact: true })).toHaveCount(0)
	await expect(viewer.locator('#ai-panel')).toHaveCount(0)
	await expect
		.poll(async () => {
			const a = await view(presenter)
			const b = await view(viewer)
			return (
				Math.abs(a.centerX - b.centerX) +
				Math.abs(a.centerY - b.centerY) +
				Math.abs(a.zoom - b.zoom)
			)
		})
		.toBeLessThan(0.01)

	await presenter.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await presenter.mouse.click(550, 350)
	await expect(viewer.locator('[data-shape-id]')).toHaveCount(1)
	const sharedShape = viewer.locator('[data-shape-id]').first()
	const shapeId = await sharedShape.getAttribute('data-shape-id')
	await presenter.getByRole('button', { name: 'Connector', exact: true }).click()
	const source = await presenter.locator(`[data-shape-id="${shapeId}"]`).boundingBox()
	if (!source) throw new Error('Presenter source shape missing')
	await presenter.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
	await expect(presenter.locator(`[data-snap-target="${shapeId}"] .snap-anchor`)).toHaveCount(12)
	await expect(viewer.locator('.whiteboard-cursor')).toContainText('Jason Huang')
	await expect(viewer.locator('.snap-anchor')).toHaveCount(0)
	await presenter.getByRole('button', { name: 'Connector', exact: true }).hover()
	await expect(presenter.locator('.snap-anchor')).toHaveCount(0)
	await expect(viewer.locator('.whiteboard-cursor').filter({ hasText: 'Jason Huang' })).toHaveCount(
		0,
	)
	await presenter.getByRole('button', { name: 'Select', exact: true }).click()
	await viewer.keyboard.press('n')
	await viewer.keyboard.press('Delete')
	await viewer.mouse.dblclick(800, 500)
	await expect(viewer.locator('textarea.inline-editor, .inline-editor')).toHaveCount(0)
	await expect(presenter.locator(`[data-shape-id="${shapeId}"]`)).toHaveCount(1)

	await viewer.mouse.move(600, 450)
	await expect(presenter.locator('.whiteboard-cursor')).toContainText('Alice Chen')
	const cursorId = await presenter.locator('.whiteboard-cursor').getAttribute('data-cursor-id')
	const cursorColor = await presenter
		.locator('.whiteboard-cursor span')
		.evaluate((node) => getComputedStyle(node).backgroundColor)
	expect(
		await presenter
			.locator(`[data-member-id="${cursorId}"]`)
			.evaluate((node) => getComputedStyle(node).backgroundColor),
	).toBe(cursorColor)

	await viewer.mouse.move(700, 500)
	await viewer.mouse.down()
	await viewer.mouse.move(820, 560, { steps: 6 })
	await viewer.mouse.up()
	await expect(viewer.locator('.whiteboard-detached-frame')).toBeVisible()
	const detached = await view(viewer)
	await presenter.mouse.move(650, 400)
	await presenter.mouse.wheel(0, -250)
	await expect.poll(async () => (await view(presenter)).zoom).toBeGreaterThan(detached.zoom)
	expect(await view(viewer)).toEqual(detached)
	await viewer.screenshot({ path: testInfo.outputPath('viewer-detached.png') })
	await viewer.getByRole('button', { name: '回到演示者视角' }).click()
	await expect(viewer.locator('.whiteboard-detached-frame')).toHaveCount(0)
	await expect
		.poll(async () => {
			const a = await view(presenter)
			const b = await view(viewer)
			return (
				Math.abs(a.centerX - b.centerX) +
				Math.abs(a.centerY - b.centerY) +
				Math.abs(a.zoom - b.zoom)
			)
		})
		.toBeLessThan(0.01)

	await viewer.setViewportSize({ width: 390, height: 844 })
	await expect
		.poll(async () => Math.abs((await view(viewer)).centerX - (await view(presenter)).centerX))
		.toBeLessThan(0.01)
	await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click()
	await expect(viewer.locator('.whiteboard-detached-frame')).toBeVisible()
	await viewer.screenshot({ path: testInfo.outputPath('viewer-mobile.png') })
	await viewer.getByRole('button', { name: '回到演示者视角' }).click()
	await presenter.screenshot({ path: testInfo.outputPath('presenter.png') })
	const privateState = await (await request.get('/api/state')).json()
	expect(privateState.canvases.some((canvas: { id: string }) => canvas.id === id)).toBe(false)
	await viewer.close()
	await expect(presenter.locator('.whiteboard-members')).not.toContainText('Alice Chen')
})

test('duplicate presenter, waiting state, reconnect and invalid links are explicit', async ({
	page,
	context,
	request,
}) => {
	const response = await request.post('/api/whiteboards', { data: { name: 'Presenter lifecycle' } })
	expect(response.status()).toBe(201)
	const { whiteboard } = await response.json()
	const viewer = await context.newPage()
	let disconnectViewer: (() => void) | undefined
	await viewer.routeWebSocket(/\/api\/events\?/, (socket) => {
		const server = socket.connectToServer()
		disconnectViewer = () => {
			server.close()
			socket.close()
		}
	})
	await viewer.goto(`/?whiteboardid=${whiteboard.id}&username=Viewer&sharer=false`)
	await expect(viewer.getByRole('status')).toContainText(['Live', 'Waiting for presenter'])
	await page.goto(`/?whiteboardid=${whiteboard.id}&username=Host&sharer=true`)
	await expect(viewer.locator('.whiteboard-view-controls')).toContainText('Following presenter')
	const duplicate = await context.newPage()
	await duplicate.goto(`/?whiteboardid=${whiteboard.id}&username=Other&sharer=true`)
	await expect(duplicate.getByRole('alert')).toContainText('already has a presenter')
	await page.close()
	await expect(viewer.locator('.whiteboard-view-controls')).toContainText('Waiting for presenter')
	await duplicate.getByRole('button', { name: 'Retry', exact: true }).click()
	await expect(duplicate.locator('.whiteboard-presence')).toContainText('Presenting')
	const identity = await duplicate
		.locator('.whiteboard-member')
		.filter({ hasText: /^Viewer$/ })
		.getAttribute('data-member-id')
	if (!disconnectViewer) throw new Error('Viewer did not open its events connection')
	disconnectViewer()
	await expect(viewer.locator('.whiteboard-presence')).toContainText('Reconnecting')
	await expect(viewer.locator('.whiteboard-presence')).toContainText('Live')
	await expect(
		duplicate.locator('.whiteboard-member').filter({ hasText: /^Viewer$/ }),
	).toHaveAttribute('data-member-id', identity ?? '')
	await viewer.reload()
	await expect(viewer.locator('.whiteboard-view-controls')).toContainText('Following presenter')
	await expect(duplicate.locator('.whiteboard-members')).toContainText('Viewer')
	await viewer.goto('/?whiteboardid=missing&username=Viewer&sharer=false')
	await expect(viewer.getByRole('alert')).toBeVisible()
	await viewer.goto(`/?whiteboardid=${whiteboard.id}&username=&sharer=anything`)
	await expect(viewer.getByRole('alert')).toContainText('Provide a whiteboard ID')
	await duplicate.close()
	await viewer.close()
})

test('presenter AI generation, voice input and images stay on the shared board', async ({
	page,
	context,
	request,
}) => {
	test.setTimeout(45000)
	await installMicrophoneMock(context)
	const mai = await mockMaiTranscription(page)
	const created = await request.post('/api/whiteboards', { data: { name: 'Shared AI' } })
	const { whiteboard } = await created.json()
	await page.goto(`/?whiteboardid=${whiteboard.id}&username=Host&sharer=true`)
	await expect(page.locator('.whiteboard-presence')).toContainText('Live')
	const viewer = await context.newPage()
	await viewer.goto(`/?whiteboardid=${whiteboard.id}&username=Viewer&sharer=false`)
	await expect(viewer.locator('.whiteboard-members')).toContainText('Host')
	const chat = await openAssistant(page, 'Chat')
	await expect(chat.getByRole('button', { name: 'New canvas', exact: true })).toHaveCount(0)
	const composer = chat.getByRole('textbox', { name: 'Message the assistant' })
	await composer.fill('Draw projectile motion')
	await composer.press('Enter')
	await expect(chat.getByText('The diagram is ready', { exact: false })).toBeVisible({
		timeout: 15000,
	})
	await expect(viewer.locator('[data-shape-id="mock-1-title"]')).toBeVisible()

	const live = await openAssistant(page, 'Live')
	await live.getByRole('radio', { name: 'MAI Transcribe' }).click()
	await live.getByRole('button', { name: 'Start recording' }).click()
	await expect.poll(() => mai.completed).toBeGreaterThan(0)
	await live.getByRole('button', { name: 'Stop recording' }).click()
	await expect.poll(() => mai.closed).toBe(true)
	await closeAssistant(page)
	const imageResponse = page.waitForResponse(
		(response) => response.url().includes('/api/images/') && response.request().method() === 'GET',
	)
	await page.getByLabel('Choose image').setInputFiles({
		name: 'pixel.png',
		mimeType: 'image/png',
		buffer: Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
			'base64',
		),
	})
	expect((await imageResponse).status()).toBe(200)
	await expect(viewer.locator('image.canvas-image')).toHaveCount(1)
	const source = await viewer.locator('image.canvas-image').getAttribute('href')
	expect(source).toContain('whiteboardSession=')
	const imageStatus = await viewer.evaluate(async (url) => (await fetch(url ?? '')).status, source)
	expect(imageStatus).toBe(200)
	const state = await (await request.get('/api/state')).json()
	expect(state.canvases.some((canvas: { id: string }) => canvas.id === whiteboard.id)).toBe(false)
	await viewer.close()
})
