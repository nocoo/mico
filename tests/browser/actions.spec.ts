import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test'
import type { ActionItem, Board, CanvasShape, CanvasSnapshot } from '../../src/shared/types'
import { differingPixels } from './pixels'
import { board, closeAssistant, ISOLATED_ORIGIN, resetBoard, resetView, worldView } from './support'

const items: ActionItem[] = [
	{ id: 'demo', text: 'Maya：准备商业视频素材并录制 Demo', done: false },
	{ id: 'models', text: '周越：对比各模型 tool call 延迟，给出选型', done: false },
	{ id: 'components', text: '陈诺：厘清新旧组件之间的关系', done: false },
]

function actionShape(
	id = 'actions',
	nextItems: ActionItem[] = structuredClone(items),
	x = 400,
	y = 250,
	h = 250,
): CanvasShape {
	return {
		id,
		type: 'actions',
		x,
		y,
		w: 300,
		h,
		color: '#f1fadc',
		title: '行动项',
		items: nextItems,
	}
}

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
	await resetBoard(request, [])
	return state(request)
}

function actionButton(page: Page, itemId: string, shapeId = 'actions'): Locator {
	return page.locator(`[data-shape-id="${shapeId}"] [data-action-id="${itemId}"]`)
}

async function itemDone(request: APIRequestContext, shapeId: string, itemId: string) {
	const shape = (await board(request)).shapes.find((candidate) => candidate.id === shapeId)
	if (shape?.type !== 'actions') throw new Error(`Missing action card ${shapeId}`)
	return shape.items?.find((item) => item.id === itemId)?.done
}

async function screenshotElement(element: Locator, width: number, height: number) {
	const box = await element.boundingBox()
	if (!box) throw new Error('Missing action card')
	return element.page().screenshot({
		clip: {
			x: Math.round(box.x) - 20,
			y: Math.round(box.y) - 20,
			width: width + 40,
			height: height + 40,
		},
		animations: 'disabled',
	})
}

async function mossTool(request: APIRequestContext, name: string, input: unknown) {
	const snapshot = await state(request)
	const response = await request.post('/api/moss/tool', {
		data: {
			canvasId: snapshot.activeCanvasId,
			selection: [],
			revision: snapshot.board.revision,
			name,
			input,
		},
	})
	expect(response.ok()).toBe(true)
	return (await response.json()) as { result: { ok: boolean; revision: number } }
}

test.beforeEach(async ({ page, request, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetCanvases(request)
	await resetBoard(request, [actionShape()])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await resetView(page)
})

test.afterEach(async ({ request }) => {
	await resetCanvases(request)
})

test('click and keyboard toggle controlled items without optimistic state or drag', async ({
	page,
	request,
}) => {
	const sent: unknown[] = []
	let failNext = true
	await page.route('**/api/operations', async (route) => {
		const payload = route.request().postDataJSON() as { operations?: unknown[] }
		if (payload.operations?.[0] && typeof payload.operations[0] === 'object') {
			const operation = payload.operations[0] as Record<string, unknown>
			if (operation.type === 'set_action_done') {
				sent.push(operation)
				if (failNext) {
					failNext = false
					await route.fulfill({
						status: 500,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'forced failure' }),
					})
					return
				}
			}
		}
		await route.continue()
	})

	const card = page.locator('[data-shape-id="actions"]')
	const initialPosition = await board(request)
	await actionButton(page, 'demo').click()
	await expect(page.locator('.notice')).toContainText('Operation failed: HTTP 500')
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'false')
	await expect.poll(() => itemDone(request, 'actions', 'demo')).toBe(false)

	await actionButton(page, 'demo').click()
	await expect.poll(() => itemDone(request, 'actions', 'demo')).toBe(true)
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'true')
	await actionButton(page, 'models').focus()
	await page.keyboard.press('Enter')
	await expect.poll(() => itemDone(request, 'actions', 'models')).toBe(true)
	await expect(actionButton(page, 'models')).toHaveAttribute('aria-checked', 'true')

	expect(sent).toEqual([
		{ type: 'set_action_done', id: 'actions', itemId: 'demo', done: true },
		{ type: 'set_action_done', id: 'actions', itemId: 'demo', done: true },
		{ type: 'set_action_done', id: 'actions', itemId: 'models', done: true },
	])
	const after = await board(request)
	expect(after.shapes.find((shape) => shape.id === 'actions')).toMatchObject({
		x: 400,
		y: 250,
	})
	expect(initialPosition.shapes.find((shape) => shape.id === 'actions')).toMatchObject({
		x: 400,
		y: 250,
	})
	await expect(card.locator('.selection')).toHaveCount(0)

	await actionButton(page, 'models').focus()
	await page.keyboard.press('ControlOrMeta+z')
	await expect.poll(() => itemDone(request, 'actions', 'models')).toBe(false)
	await expect(actionButton(page, 'models')).toHaveAttribute('aria-checked', 'false')
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'true')

	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'true')
	await expect(actionButton(page, 'models')).toHaveAttribute('aria-checked', 'false')

	const canvases = await state(request)
	const created = await request.post('/api/canvases', {
		data: { name: 'Other canvas', activate: false },
	})
	expect(created.ok()).toBe(true)
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await page.getByRole('button', { name: 'Open canvas Other canvas', exact: true }).click()
	await expect
		.poll(async () => (await state(request)).activeCanvasId)
		.not.toBe(canvases.activeCanvasId)
	await expect(page.locator('[data-shape-id="actions"]')).toHaveCount(0)
	const originalCanvas = canvases.canvases.find((canvas) => canvas.id === canvases.activeCanvasId)
	if (!originalCanvas) throw new Error('Missing original canvas')
	await page.getByRole('button', { name: `Open canvas ${originalCanvas.name}` }).click()
	await expect.poll(async () => (await state(request)).activeCanvasId).toBe(canvases.activeCanvasId)
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'true')
	await expect(actionButton(page, 'models')).toHaveAttribute('aria-checked', 'false')
})

test('note label editing preserves drafts, ignores IME Enter and detects external conflicts', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		{
			id: 'note',
			type: 'note',
			x: 400,
			y: 250,
			w: 224,
			h: 150,
			color: '#e2f5fc',
			label: 'Original label',
			text: 'Prototype note',
		},
	])
	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await resetView(page)
	await page.locator('[data-shape-id="note"] rect').first().click()
	const label = page.getByLabel('Label', { exact: true })
	await expect(label).toHaveValue('Original label')
	await label.focus()
	await label.fill('Uncommitted draft')

	const externalUpdate = await request.post('/api/operations', {
		data: {
			operations: [{ type: 'update', id: 'note', patch: { label: 'External label' } }],
		},
	})
	expect(externalUpdate.ok()).toBe(true)
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((candidate) => candidate.id === 'note')
			return shape?.type === 'note' ? shape.label : null
		})
		.toBe('External label')
	await expect(page.locator('[data-shape-id="note"] .sticky-chip')).toHaveText('External label')
	await expect(label).toBeFocused()
	await expect(label).toHaveValue('Uncommitted draft')

	await label.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
	await expect(label).toBeFocused()
	await expect(label).toHaveValue('Uncommitted draft')
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((candidate) => candidate.id === 'note')
			return shape?.type === 'note' ? shape.label : null
		})
		.toBe('External label')

	await label.press('Enter')
	await expect(label).not.toBeFocused()
	await expect(label).toHaveValue('External label')
	await expect(page.getByRole('status', { name: 'Label conflict' })).toContainText(
		'Label changed elsewhere; your draft was not applied.',
	)
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((candidate) => candidate.id === 'note')
			return shape?.type === 'note' ? shape.label : null
		})
		.toBe('External label')

	const unfocusedUpdate = await request.post('/api/operations', {
		data: {
			operations: [{ type: 'update', id: 'note', patch: { label: 'Latest external label' } }],
		},
	})
	expect(unfocusedUpdate.ok()).toBe(true)
	await expect(label).toHaveValue('Latest external label')

	await label.focus()
	await label.fill('Committed draft')
	await label.press('Enter')
	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((candidate) => candidate.id === 'note')
			return shape?.type === 'note' ? shape.label : null
		})
		.toBe('Committed draft')
})

test('single-item operation preserves concurrent card text and item identity', async ({
	page,
	request,
}) => {
	let releaseToggle: (() => void) | undefined
	const toggleGate = new Promise<void>((resolve) => {
		releaseToggle = resolve
	})
	let blocked = false
	await page.route('**/api/operations', async (route) => {
		const payload = route.request().postDataJSON() as { operations?: unknown[] }
		const operation = payload.operations?.[0] as Record<string, unknown> | undefined
		if (operation?.type === 'set_action_done') {
			blocked = true
			await toggleGate
		}
		await route.continue()
	})

	await actionButton(page, 'demo').click()
	await expect.poll(() => blocked).toBe(true)
	const updatedItems = structuredClone(items)
	updatedItems[0].text = 'Maya：用新版商业素材录制 Demo'
	const aiUpdate = await request.post('/api/operations', {
		data: {
			operations: [{ type: 'update', id: 'actions', patch: { items: updatedItems } }],
		},
	})
	expect(aiUpdate.ok()).toBe(true)
	await expect(actionButton(page, 'demo')).toContainText('新版商业素材')
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'false')
	releaseToggle?.()

	await expect
		.poll(async () => {
			const shape = (await board(request)).shapes.find((candidate) => candidate.id === 'actions')
			if (shape?.type !== 'actions') return null
			return shape.items?.[0]
		})
		.toEqual({ id: 'demo', text: 'Maya：用新版商业素材录制 Demo', done: true })
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'true')
})

test('action conflict retry stops after switching to another canvas with the same ids', async ({
	page,
	request,
}) => {
	const original = await state(request)
	const created = await request.post('/api/canvases', {
		data: { name: 'Duplicate ids', activate: false },
	})
	expect(created.ok()).toBe(true)
	const createdState = (await created.json()) as CanvasSnapshot & { createdCanvasId: string }
	const duplicate = createdState.canvases.find(
		(canvas) => canvas.id === createdState.createdCanvasId,
	)
	if (!duplicate) throw new Error('Missing duplicate-id canvas')
	const populated = await request.post('/api/operations', {
		data: {
			canvasId: duplicate.id,
			operations: [{ type: 'create', shape: actionShape() }],
		},
	})
	expect(populated.ok()).toBe(true)

	let releaseToggle: (() => void) | undefined
	const toggleGate = new Promise<void>((resolve) => {
		releaseToggle = resolve
	})
	let blocked = false
	let actionWrites = 0
	await page.route('**/api/operations', async (route) => {
		const payload = route.request().postDataJSON() as {
			canvasId?: string
			operations?: { type?: string }[]
		}
		if (payload.operations?.[0]?.type === 'set_action_done') {
			actionWrites++
			expect(payload.canvasId).toBe(original.activeCanvasId)
			blocked = true
			await toggleGate
		}
		await route.continue()
	})

	await actionButton(page, 'demo').click()
	await expect.poll(() => blocked).toBe(true)
	const originalConflict = await request.post('/api/operations', {
		data: {
			canvasId: original.activeCanvasId,
			operations: [{ type: 'update', id: 'actions', patch: { title: 'Changed elsewhere' } }],
		},
	})
	expect(originalConflict.ok()).toBe(true)
	const switched = await request.put('/api/active-canvas', { data: { id: duplicate.id } })
	expect(switched.ok()).toBe(true)
	await expect.poll(async () => (await state(request)).activeCanvasId).toBe(duplicate.id)
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'false')
	releaseToggle?.()
	await expect(page.locator('.notice')).toContainText('Operation failed: HTTP 409')
	await expect.poll(() => actionWrites).toBe(1)

	const originalDetail = await request.get(`/api/canvases/${original.activeCanvasId}`)
	expect(originalDetail.ok()).toBe(true)
	const originalBoard = ((await originalDetail.json()) as { board: Board }).board
	const originalCard = originalBoard.shapes.find((shape) => shape.id === 'actions')
	const duplicateCard = (await board(request)).shapes.find((shape) => shape.id === 'actions')
	if (originalCard?.type !== 'actions' || duplicateCard?.type !== 'actions')
		throw new Error('Missing duplicate action cards')
	expect(originalCard.items?.find((item) => item.id === 'demo')?.done).toBe(false)
	expect(duplicateCard.items?.find((item) => item.id === 'demo')?.done).toBe(false)
})

test('pan, space-pan and connector gestures stay separate from checkbox activation', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		actionShape(),
		{
			id: 'peer',
			type: 'rectangle',
			x: 800,
			y: 300,
			w: 160,
			h: 80,
			color: '#00a2e1',
			text: 'Peer',
		},
	])
	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await resetView(page)

	await actionButton(page, 'demo').focus()
	const middleBox = await actionButton(page, 'demo').boundingBox()
	if (!middleBox) throw new Error('Missing action checkbox')
	const beforeMiddlePan = await worldView(page)
	await page.mouse.move(middleBox.x + middleBox.width / 2, middleBox.y + middleBox.height / 2)
	await page.mouse.down({ button: 'middle' })
	await page.mouse.move(
		middleBox.x + middleBox.width / 2 + 38,
		middleBox.y + middleBox.height / 2 + 21,
		{ steps: 6 },
	)
	await page.mouse.up({ button: 'middle' })
	const afterMiddlePan = await worldView(page)
	expect(afterMiddlePan.x - beforeMiddlePan.x).toBeCloseTo(38, 1)
	expect(afterMiddlePan.y - beforeMiddlePan.y).toBeCloseTo(21, 1)
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'false')
	await resetView(page)

	await page.getByRole('button', { name: 'Pan', exact: true }).click()
	const beforePan = await worldView(page)
	const panBox = await actionButton(page, 'demo').boundingBox()
	if (!panBox) throw new Error('Missing action checkbox')
	await page.mouse.move(panBox.x + panBox.width / 2, panBox.y + panBox.height / 2)
	await page.mouse.down()
	await page.mouse.move(panBox.x + panBox.width / 2 + 48, panBox.y + panBox.height / 2 + 26, {
		steps: 6,
	})
	await page.mouse.up()
	const afterPan = await worldView(page)
	expect(afterPan.x - beforePan.x).toBeCloseTo(48, 1)
	expect(afterPan.y - beforePan.y).toBeCloseTo(26, 1)
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'false')

	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await resetView(page)
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
	await page.keyboard.down('Space')
	const spaceBox = await actionButton(page, 'demo').boundingBox()
	if (!spaceBox) throw new Error('Missing action checkbox')
	const beforeSpacePan = await worldView(page)
	await page.mouse.move(spaceBox.x + spaceBox.width / 2, spaceBox.y + spaceBox.height / 2)
	await page.mouse.down()
	await page.mouse.move(
		spaceBox.x + spaceBox.width / 2 + 34,
		spaceBox.y + spaceBox.height / 2 + 18,
		{
			steps: 5,
		},
	)
	await page.mouse.up()
	await page.keyboard.up('Space')
	const afterSpacePan = await worldView(page)
	expect(afterSpacePan.x - beforeSpacePan.x).toBeCloseTo(34, 1)
	expect(afterSpacePan.y - beforeSpacePan.y).toBeCloseTo(18, 1)
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'false')

	await resetView(page)
	await page.getByRole('button', { name: 'Connector', exact: true }).click()
	const connectorStart = await actionButton(page, 'demo').boundingBox()
	const peer = await page.locator('[data-shape-id="peer"]').boundingBox()
	if (!connectorStart || !peer) throw new Error('Missing connector targets')
	await page.mouse.move(
		connectorStart.x + connectorStart.width / 2,
		connectorStart.y + connectorStart.height / 2,
	)
	await page.mouse.down()
	await page.mouse.move(peer.x + peer.width / 2, peer.y + peer.height / 2, { steps: 8 })
	await page.mouse.up()
	await expect
		.poll(async () =>
			(await board(request)).shapes.some(
				(shape) => shape.type === 'connector' && shape.from === 'actions' && shape.to === 'peer',
			),
		)
		.toBe(true)
	await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'false')
})

test('painted action surface matches authoritative shape height without invisible hit area', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		actionShape('oversized', [], 400, 250, 400),
		{
			id: 'below-actions',
			type: 'rectangle',
			x: 420,
			y: 670,
			w: 100,
			h: 60,
			color: '#00a2e1',
			text: 'Below',
		},
	])
	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await resetView(page)

	const card = page.locator('[data-shape-id="oversized"] .el-actions')
	const foreignObject = page.locator('[data-shape-id="oversized"] foreignObject')
	const cardBox = await card.boundingBox()
	const foreignBox = await foreignObject.boundingBox()
	if (!cardBox || !foreignBox) throw new Error('Missing oversized action card geometry')
	expect(Math.abs(cardBox.height - 400)).toBeLessThanOrEqual(1)
	expect(Math.abs(cardBox.height - foreignBox.height)).toBeLessThanOrEqual(1)
	expect(
		await card.evaluate((element) =>
			document
				.elementFromPoint(
					element.getBoundingClientRect().right - 12,
					element.getBoundingClientRect().bottom - 12,
				)
				?.closest('[data-shape-id]')
				?.getAttribute('data-shape-id'),
		),
	).toBe('oversized')

	await page.locator('[data-shape-id="below-actions"] rect').first().click()
	await expect(page.locator('[data-shape-id="below-actions"] .selection')).toHaveCount(1)
	await expect(page.locator('[data-shape-id="oversized"] .selection')).toHaveCount(0)
})

test('AI tool creates and updates long multilingual action cards without overflow', async ({
	page,
	request,
}) => {
	await resetBoard(request, [])
	const longTitle = 'W'.repeat(120)
	const longText =
		'超长中文行动项，包含没有空格的连续内容、English words، العربية、日本語、emoji-are-plain-text and a verylongunbrokentoken'.repeat(
			4,
		)
	const created = await mossTool(request, 'upsert_action_card', {
		id: 'long-actions',
		x: 400,
		y: 250,
		title: longTitle,
		items: [{ id: 'long', text: longText }],
		w: 300,
		h: 120,
	})
	expect(created.result.ok).toBe(true)
	const createdCard = (await board(request)).shapes.find((shape) => shape.id === 'long-actions')
	if (createdCard?.type !== 'actions') throw new Error('AI tool did not create the action card')
	expect(createdCard.h).toBeGreaterThan(120)
	const updated = await mossTool(request, 'upsert_action_card', {
		id: 'long-actions',
		title: longTitle,
		items: [
			{ id: 'long', text: `${longText} 更新后仍需完整显示。`.repeat(2) },
			{ id: 'second', text: '第二个待办' },
		],
	})
	expect(updated.result.ok).toBe(true)
	const empty = await mossTool(request, 'upsert_action_card', {
		id: 'empty',
		x: 760,
		y: 250,
		title: '行动项',
		items: [],
	})
	expect(empty.result.ok).toBe(true)
	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await resetView(page)

	const longCard = page.locator('[data-shape-id="long-actions"] .el-actions')
	await expect(longCard).toBeVisible()
	const title = longCard.locator('.el-actions-title')
	await expect(longCard).toHaveAttribute('aria-label', longTitle)
	await expect(title).toHaveAttribute('title', longTitle)
	await expect(title).toHaveText(longTitle)
	await expect(title).toHaveCSS('text-overflow', 'ellipsis')
	const titleBox = await title.boundingBox()
	const headingBox = await longCard.locator('h3').boundingBox()
	if (!titleBox || !headingBox) throw new Error('Missing action card title geometry')
	expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(headingBox.x + headingBox.width)
	const dimensions = await longCard.evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
	}))
	expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
	expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight)
	const cardBox = await longCard.boundingBox()
	const hitbox = await page.locator('[data-shape-id="long-actions"] foreignObject').boundingBox()
	if (!cardBox || !hitbox) throw new Error('Missing action card geometry')
	expect(Math.abs(cardBox.width - hitbox.width)).toBeLessThanOrEqual(1)
	expect(cardBox.height).toBeLessThanOrEqual(hitbox.height + 1)
	for (const button of await longCard.locator('.act').all()) {
		const buttonBox = await button.boundingBox()
		if (!buttonBox) throw new Error('Missing action item geometry')
		expect(buttonBox.x).toBeGreaterThanOrEqual(cardBox.x)
		expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
		expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height)
	}
	await expect(page.locator('[data-shape-id="empty"] .el-actions-empty')).toHaveText('暂无行动项')
})

test('action card motion respects normal and reduced motion settings', async ({ page }) => {
	const motionOf = async () =>
		actionButton(page, 'demo').evaluate((element) => {
			const style = getComputedStyle(element)
			const checkStyle = getComputedStyle(element.querySelector('.box svg') as SVGSVGElement)
			return {
				scale: style.scale,
				duration: style.transitionDuration,
				timing: style.transitionTimingFunction,
				checkDuration: checkStyle.transitionDuration,
				checkTiming: checkStyle.transitionTimingFunction,
			}
		})

	await page.emulateMedia({ reducedMotion: 'no-preference' })
	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	const normal = await motionOf()
	expect(normal.duration).toContain('0.4s')
	expect(normal.timing).toContain('linear')
	expect(normal.checkDuration).toBe('0.45s')
	expect(normal.checkTiming).toContain('linear')

	await page.emulateMedia({ reducedMotion: 'reduce' })
	const reduced = await motionOf()
	expect(reduced.duration).toBe('1e-05s')
	expect(reduced.checkDuration).toBe('1e-05s')
	await actionButton(page, 'demo').hover()
	await page.mouse.down()
	await expect(actionButton(page, 'demo')).toHaveCSS('scale', '1')
	await page.mouse.up()
})

test('unchecked and checked action cards match the original prototype pixels', async ({
	page,
	context,
	request,
}) => {
	const reference = await context.newPage()
	await reference.setViewportSize({ width: 1440, height: 960 })
	await reference.emulateMedia({ reducedMotion: 'reduce' })
	await reference.goto(
		pathToFileURL(resolve(process.cwd(), 'docs/prototypes/teams-ai-whiteboard.html')).href,
	)
	try {
		await reference.locator('#hero-skip').click()
		await reference.addStyleTag({
			content:
				'.aurora, .grain, #hero, #ctx, #panel, .topbar, .tools, #aistatus, .minimap, #edges, #ink, #aicur { display: none !important; } #stage { background: white !important; } #world { transform: translate(-1750px, 0) scale(1) !important; } .el.pop { animation: none !important; }',
		})
		const referenceCard = reference.locator('.el-actions[data-id="act"]')
		await expect(referenceCard).toBeVisible()
		const referenceBox = await referenceCard.boundingBox()
		if (!referenceBox) throw new Error('Missing prototype action card')
		const width = Math.round(referenceBox.width)
		const height = Math.round(referenceBox.height)

		await resetBoard(request, [actionShape('actions', structuredClone(items), 400, 250, height)])
		await page.reload()
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		await closeAssistant(page)
		await resetView(page)
		await page.addStyleTag({
			content:
				'.app, .canvas-backdrop { background: white !important; } .canvas-aurora, .canvas-grain, .ai-assistant, .toolbar-module, .topbar.frame-identity, .selection-panel { display: none !important; } svg.canvas { background-image: none !important; }',
		})
		const actualCard = page.locator('[data-shape-id="actions"] .el-actions')
		await expect(actualCard).toBeVisible()
		const actualBox = await actualCard.boundingBox()
		if (!actualBox) throw new Error('Missing rendered action card')
		expect(Math.round(actualBox.width)).toBe(width)
		expect(Math.round(actualBox.height)).toBe(height)

		const expectedUnchecked = await screenshotElement(referenceCard, width, height)
		const actualUnchecked = await screenshotElement(actualCard, width, height)
		const unchecked = await differingPixels(page, expectedUnchecked, actualUnchecked)
		expect(
			unchecked.different / unchecked.total,
			`${unchecked.different}/${unchecked.total}`,
		).toBeLessThanOrEqual(0.002)

		await referenceCard.locator('.act').first().click()
		await actionButton(page, 'demo').click()
		await expect(actionButton(page, 'demo')).toHaveAttribute('aria-checked', 'true')
		const expectedChecked = await screenshotElement(referenceCard, width, height)
		const actualChecked = await screenshotElement(actualCard, width, height)
		const checked = await differingPixels(page, expectedChecked, actualChecked)
		expect(
			checked.different / checked.total,
			`${checked.different}/${checked.total}`,
		).toBeLessThanOrEqual(0.002)
	} finally {
		await reference.close()
	}
})
