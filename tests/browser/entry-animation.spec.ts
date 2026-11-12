import { expect, test } from '@playwright/test'
import { ISOLATED_ORIGIN, resetBoard } from './support'

test.beforeEach(async ({ request, baseURL, page }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
	await page.emulateMedia({ reducedMotion: 'no-preference' })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
})

test('new node animation survives an update and does not replay', async ({ page, request }) => {
	const created = await request.post('/api/operations', {
		data: {
			operations: [
				{
					type: 'create',
					shape: {
						id: 'animated-node',
						type: 'rectangle',
						x: 200,
						y: 200,
						w: 200,
						h: 100,
						color: '#00a2e1',
						text: 'Node',
					},
				},
			],
		},
	})
	expect(created.ok()).toBe(true)
	const node = page.locator('[data-shape-id="animated-node"]')
	await expect(node).toHaveClass(/canvas-entry/)
	const updated = await request.post('/api/operations', {
		data: {
			operations: [{ type: 'update', id: 'animated-node', patch: { text: 'Updated node' } }],
		},
	})
	expect(updated.ok()).toBe(true)
	await expect(node).toContainText('Updated node')
	await expect(node).toHaveClass(/canvas-entry/)
	await expect(node).not.toHaveClass(/canvas-entry/, { timeout: 5000 })
	const updatedAgain = await request.post('/api/operations', {
		data: { operations: [{ type: 'update', id: 'animated-node', patch: { text: 'Final node' } }] },
	})
	expect(updatedAgain.ok()).toBe(true)
	await expect(node).toContainText('Final node')
	await expect(node).not.toHaveClass(/canvas-entry/)
})

test('manual drag shapes do not pop, but new text does', async ({ page }) => {
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await page.mouse.move(200, 400)
	await page.mouse.down()
	await page.mouse.move(380, 500, { steps: 4 })
	await page.mouse.up()
	const rectangle = page
		.locator('.canvas-shape')
		.filter({ has: page.locator('.el-shape[data-shape="rectangle"]') })
	await expect(rectangle).toHaveCount(1)
	await expect(rectangle).not.toHaveClass(/canvas-entry/)
	await page.getByRole('button', { name: 'Text', exact: true }).click()
	await page.mouse.click(500, 300)
	const text = page.locator('.canvas-shape').filter({ has: page.locator('.canvas-text') })
	await expect(text).toHaveCount(1)
	await expect(text).toHaveClass(/canvas-entry/)
	await expect(text).not.toHaveClass(/canvas-entry/, { timeout: 5000 })
})

test('reduced motion does not replay new nodes when preference changes', async ({
	page,
	request,
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	const created = await request.post('/api/operations', {
		data: {
			operations: [
				{
					type: 'create',
					shape: {
						id: 'reduced-node',
						type: 'rectangle',
						x: 200,
						y: 200,
						w: 200,
						h: 100,
						color: '#00a2e1',
						text: 'Node',
					},
				},
			],
		},
	})
	expect(created.ok()).toBe(true)
	const node = page.locator('[data-shape-id="reduced-node"]')
	await expect(node).toBeVisible()
	await expect(node).not.toHaveClass(/canvas-entry/)
	await page.emulateMedia({ reducedMotion: 'no-preference' })
	await expect(node).not.toHaveClass(/canvas-entry/)
})

test('short connector finishes drawing even when no arrowhead fits', async ({ page, request }) => {
	const created = await request.post('/api/operations', {
		data: {
			operations: [
				{
					type: 'create',
					shape: { id: 'left', type: 'rectangle', x: 200, y: 200, w: 10, h: 10, color: '#00a2e1' },
				},
				{
					type: 'create',
					shape: { id: 'right', type: 'rectangle', x: 220, y: 200, w: 10, h: 10, color: '#00a2e1' },
				},
				{
					type: 'create',
					shape: {
						id: 'short-edge',
						type: 'connector',
						from: 'left',
						to: 'right',
						fromAnchor: 3,
						toAnchor: 2,
						color: '#00a2e1',
					},
				},
			],
		},
	})
	expect(created.ok()).toBe(true)
	const edge = page.locator('[data-shape-id="short-edge"]')
	await expect(edge).toHaveClass(/draw/)
	await expect(edge.locator('.e-head')).toHaveCount(0)
	await expect(edge).not.toHaveClass(/draw/, { timeout: 5000 })
})
