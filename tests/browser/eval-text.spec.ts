import { type APIRequestContext, expect, test } from '@playwright/test'
import type { Board, CanvasShape } from '../../src/shared/types'

async function board(request: APIRequestContext): Promise<Board> {
	const response = await request.get('/api/board')
	expect(response.ok()).toBe(true)
	return response.json()
}

test.beforeEach(async ({ request, page, baseURL }) => {
	if (baseURL !== 'http://127.0.0.1:27063')
		throw new Error('Refusing to mutate a non-isolated canvas')
	const current = await board(request)
	const shapes: CanvasShape[] = [
		{
			id: 'eval-single-short',
			type: 'text',
			x: 160,
			y: 160,
			w: 240,
			h: 24,
			color: '#242a38',
			text: '短高度中的中文文本',
			font: 'sans',
			fontSize: 32,
			fontWeight: 500,
		},
		{
			id: 'eval-multiline-short',
			type: 'text',
			x: 160,
			y: 260,
			w: 180,
			h: 24,
			color: '#242a38',
			text: '这是一段很长的中文文本需要自动换行不被截断\n第二行仍然要完整显示\n第三行中文文本',
			font: 'sans',
			fontSize: 32,
			fontWeight: 500,
		},
	]
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
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await expect(page.locator('.typographic-text')).toHaveCount(2)
	await expect(page.locator('.canvas')).toHaveAttribute('data-initial-fit-ready', 'true')
})

for (const id of ['eval-single-short', 'eval-multiline-short']) {
	test(`${id} keeps actual text line geometry outside a short shape height`, async ({ page }) => {
		const geometry = await page
			.locator(`[data-shape-id="${id}"] .typographic-text`)
			.evaluate((element) => {
				const div = element as HTMLDivElement
				const foreignObject = div.parentElement as unknown as SVGForeignObjectElement
				const divRect = div.getBoundingClientRect()
				const foreignRect = foreignObject.getBoundingClientRect()
				const range = document.createRange()
				range.selectNodeContents(div)
				const textRects = [...range.getClientRects()].map((rect) => ({
					left: rect.left,
					right: rect.right,
					top: rect.top,
					bottom: rect.bottom,
					width: rect.width,
					height: rect.height,
				}))
				const divStyle = getComputedStyle(div)
				const foreignStyle = getComputedStyle(foreignObject)
				return {
					div: {
						left: divRect.left,
						right: divRect.right,
						top: divRect.top,
						bottom: divRect.bottom,
						width: divRect.width,
						height: divRect.height,
						scrollHeight: div.scrollHeight,
						overflow: divStyle.overflow,
						fontSize: divStyle.fontSize,
						lineHeight: divStyle.lineHeight,
					},
					foreignObject: {
						width: foreignRect.width,
						height: foreignRect.height,
						heightAttribute: foreignObject.getAttribute('height'),
						overflow: foreignStyle.overflow,
					},
					textRects,
				}
			})

		expect(geometry.foreignObject.heightAttribute).toBe('24')
		expect(geometry.foreignObject.overflow).toBe('visible')
		expect(geometry.div.overflow).toBe('visible')
		expect(geometry.div.height).toBeGreaterThan(geometry.foreignObject.height)
		expect(geometry.div.scrollHeight).toBeGreaterThan(geometry.foreignObject.height)
		expect(geometry.textRects.length).toBeGreaterThan(0)

		const textLeft = Math.min(...geometry.textRects.map((rect) => rect.left))
		const textRight = Math.max(...geometry.textRects.map((rect) => rect.right))
		const textTop = Math.min(...geometry.textRects.map((rect) => rect.top))
		const textBottom = Math.max(...geometry.textRects.map((rect) => rect.bottom))

		expect(textLeft).toBeGreaterThanOrEqual(geometry.div.left - 2)
		expect(textRight).toBeLessThanOrEqual(geometry.div.right + 2)
		expect(textTop).toBeGreaterThanOrEqual(geometry.div.top - 2)
		expect(textBottom).toBeLessThanOrEqual(geometry.div.bottom + 2)
		expect(textBottom - textTop).toBeGreaterThan(24)
	})
}

test('initial Fit includes visible overflow after fonts and DOM commit without changing saved text', async ({
	page,
	request,
}) => {
	const current = await board(request)
	const response = await request.post('/api/operations', {
		data: {
			expectedRevision: current.revision,
			operations: [
				{
					type: 'update',
					id: 'eval-multiline-short',
					patch: { y: 2600 },
				},
			],
		},
	})
	expect(response.ok()).toBe(true)

	await page.reload()
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await expect(page.locator('.typographic-text')).toHaveCount(2)

	await expect
		.poll(async () =>
			page
				.locator('[data-shape-id="eval-multiline-short"] .typographic-text')
				.evaluate((element) => {
					const range = document.createRange()
					range.selectNodeContents(element)
					const rect = range.getBoundingClientRect()
					return rect.top >= 0 && rect.bottom <= window.innerHeight
				}),
		)
		.toBe(true)

	const saved = await board(request)
	const text = saved.shapes.find((shape) => shape.id === 'eval-multiline-short')
	expect(text).toMatchObject({ y: 2600, h: 24 })
	const initialUpdate = await response.json()
	expect(saved.revision).toBe(initialUpdate.revision)
})

test('marquee and frame bounds include text overflow below the stored height', async ({
	page,
	request,
}) => {
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	const overflow = await page
		.locator('[data-shape-id="eval-multiline-short"]')
		.evaluate((group) => {
			const foreignObject = group.querySelector('foreignObject') as SVGForeignObjectElement
			const div = foreignObject.querySelector('.typographic-text') as HTMLDivElement
			const foreignRect = foreignObject.getBoundingClientRect()
			const range = document.createRange()
			range.selectNodeContents(div)
			const textRect = range.getBoundingClientRect()
			return {
				foreignBottom: foreignRect.bottom,
				textBottom: textRect.bottom,
				textRight: textRect.right,
			}
		})

	expect(overflow.textBottom).toBeGreaterThan(overflow.foreignBottom)
	await page.mouse.move(140, overflow.foreignBottom + 20)
	await page.mouse.down()
	await page.mouse.move(overflow.textRight + 20, overflow.textBottom + 10, { steps: 8 })
	await page.mouse.up()

	await expect(page.locator('[data-shape-id="eval-multiline-short"] > rect.selection')).toHaveCount(
		1,
	)

	await page.getByRole('button', { name: 'Frame selection', exact: true }).click()
	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'frame'))
		.toBe(true)
	const saved = await board(request)
	const frame = saved.shapes.find((shape) => shape.type === 'frame') as CanvasShape | undefined
	expect(frame).toBeTruthy()
	if (frame) {
		const text = saved.shapes.find((shape) => shape.id === 'eval-multiline-short') as CanvasShape
		expect(frame.y).toBeLessThanOrEqual(text.y)
		expect(frame.y + frame.h).toBeGreaterThan(text.y + text.h)
	}
})

test('narrow wrapped dock leaves measured overflow text above the toolbar', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.getByRole('button', { name: 'Fit board', exact: true }).click()

	await expect(page.locator('.canvas')).toHaveAttribute('data-initial-fit-ready', 'true')
	const layout = await page.evaluate(() => {
		const canvas = document.querySelector('.canvas')?.getBoundingClientRect()
		const toolbar = document.querySelector('.toolbar')?.getBoundingClientRect()
		if (!canvas || !toolbar) throw new Error('Missing canvas or toolbar bounds')

		const textRects = [...document.querySelectorAll('.typographic-text')].map((element) => {
			const range = document.createRange()
			range.selectNodeContents(element)
			return range.getBoundingClientRect()
		})
		if (textRects.length === 0) throw new Error('Missing measured text')

		return {
			canvasTop: canvas.top,
			toolbarTop: toolbar.top,
			toolbarHeight: toolbar.height,
			textTop: Math.min(...textRects.map((rect) => rect.top)),
			textBottom: Math.max(...textRects.map((rect) => rect.bottom)),
		}
	})

	expect(layout.toolbarHeight).toBeGreaterThan(48)
	expect(layout.textTop).toBeGreaterThanOrEqual(layout.canvasTop + 78)
	expect(layout.textBottom).toBeLessThan(layout.toolbarTop - 8)
})

test('50-line narrow rectangle label has vertical overflow only and keeps full text through Fit', async ({
	page,
	request,
}) => {
	const current = await board(request)
	const text = Array.from({ length: 50 }, (_, index) => `短行${index + 1}`).join('\n')
	const response = await request.post('/api/operations', {
		data: {
			expectedRevision: current.revision,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'eval-label-50-lines',
						type: 'rectangle',
						x: 160,
						y: 400,
						w: 80,
						h: 60,
						color: '#183153',
						fill: '#dbeafe',
						text,
						font: 'sans',
						fontSize: 16,
						fontWeight: 500,
					},
				},
			],
		},
	})
	expect(response.ok()).toBe(true)

	await page.setViewportSize({ width: 390, height: 844 })
	await page.reload()
	await expect(page.locator('.canvas')).toHaveAttribute('data-initial-fit-ready', 'true')

	const label = page.locator('[data-shape-id="eval-label-50-lines"] .shape-label')
	await expect(label).toHaveAttribute('data-text-overflow', 'true')
	await expect(label).toHaveCSS('height', '36px')
	await expect(label).toHaveCSS('overflow-wrap', 'anywhere')

	const geometry = await label.evaluate((element) => {
		const div = element as HTMLDivElement
		const foreignObject = div.closest('foreignObject') as unknown as SVGForeignObjectElement
		const foreignRect = foreignObject.getBoundingClientRect()
		const range = document.createRange()
		range.selectNodeContents(div)
		const textRect = range.getBoundingClientRect()
		return {
			foreignWidth: foreignRect.width,
			foreignHeight: foreignRect.height,
			textWidth: textRect.right - textRect.left,
			textHeight: textRect.bottom - textRect.top,
			textLeft: textRect.left,
			textRight: textRect.right,
			scrollWidth: div.scrollWidth,
			clientWidth: div.clientWidth,
			scrollHeight: div.scrollHeight,
			clientHeight: div.clientHeight,
		}
	})

	expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
	expect(geometry.textWidth).toBeLessThanOrEqual(geometry.foreignWidth + 1)
	expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight)
	expect(geometry.textHeight).toBeGreaterThan(geometry.foreignHeight)

	await page.getByRole('button', { name: 'Fit board', exact: true }).click()
	const fitted = await label.evaluate((element) => {
		const div = element as HTMLDivElement
		const foreignObject = div.closest('foreignObject') as unknown as SVGForeignObjectElement
		const foreignRect = foreignObject.getBoundingClientRect()
		const range = document.createRange()
		range.selectNodeContents(div)
		const textRect = range.getBoundingClientRect()
		return {
			foreignWidth: foreignRect.width,
			textWidth: textRect.right - textRect.left,
			textHeight: textRect.bottom - textRect.top,
			content: div.textContent,
		}
	})
	expect(fitted.textWidth).toBeLessThanOrEqual(fitted.foreignWidth + 1)
	expect(fitted.textHeight).toBeGreaterThan(geometry.foreignHeight)
	expect(fitted.content?.split('\n')).toHaveLength(50)

	const saved = await board(request)
	const labelShape = saved.shapes.find((shape) => shape.id === 'eval-label-50-lines') as
		| CanvasShape
		| undefined
	expect(labelShape).toMatchObject({ w: 80, h: 60, text })
})

test('wide glyph overflow contributes to horizontal Fit, marquee, frame and hit bounds', async ({
	page,
	request,
}) => {
	const current = await board(request)
	const response = await request.post('/api/operations', {
		data: {
			expectedRevision: current.revision,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'eval-wide-short',
						type: 'text',
						x: 160,
						y: 400,
						w: 8,
						h: 24,
						color: '#242424',
						text: '中',
						font: 'sans',
						fontSize: 48,
						fontWeight: 500,
					},
				},
			],
		},
	})
	expect(response.ok()).toBe(true)

	await page.setViewportSize({ width: 390, height: 844 })
	await page.reload()
	await expect(page.locator('.canvas')).toHaveAttribute('data-initial-fit-ready', 'true')

	const overflow = await page
		.locator('[data-shape-id="eval-wide-short"] .typographic-text')
		.evaluate((element) => {
			const div = element as HTMLDivElement
			const foreignObject = div.parentElement as unknown as SVGForeignObjectElement
			const foreignRect = foreignObject.getBoundingClientRect()
			const range = document.createRange()
			range.selectNodeContents(div)
			const textRect = range.getBoundingClientRect()
			return {
				foreignLeft: foreignRect.left,
				foreignRight: foreignRect.right,
				foreignWidth: foreignRect.width,
				textLeft: textRect.left,
				textRight: textRect.right,
				textTop: textRect.top,
				textBottom: textRect.bottom,
			}
		})

	expect(overflow.textRight - overflow.textLeft).toBeGreaterThan(overflow.foreignWidth)

	await page.getByRole('button', { name: 'Fit board', exact: true }).click()
	const fittedOverflow = await page
		.locator('[data-shape-id="eval-wide-short"] .typographic-text')
		.evaluate((element) => {
			const div = element as HTMLDivElement
			const range = document.createRange()
			range.selectNodeContents(div)
			const rect = range.getBoundingClientRect()
			return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
		})
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.mouse.click(
		fittedOverflow.right - 4,
		fittedOverflow.top + (fittedOverflow.bottom - fittedOverflow.top) / 2,
	)
	await expect(page.getByRole('region', { name: 'Selected object properties' })).toHaveAttribute(
		'data-selected-id',
		'eval-wide-short',
	)

	await page.mouse.move(fittedOverflow.left - 10, fittedOverflow.top - 10)
	await page.mouse.down()
	await page.mouse.move(fittedOverflow.right + 10, fittedOverflow.bottom + 10, { steps: 6 })
	await page.mouse.up()
	await page.getByRole('button', { name: 'Frame selection', exact: true }).click()

	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'frame'))
		.toBe(true)
	const saved = await board(request)
	const wide = saved.shapes.find((shape) => shape.id === 'eval-wide-short') as CanvasShape
	const frame = saved.shapes.find((shape) => shape.type === 'frame') as CanvasShape
	expect(wide.w).toBe(8)
	expect(wide.h).toBe(24)
	expect(frame.w).toBeGreaterThan(wide.w + 64)
})

test('user interaction cancels pending initial fit instead of moving the board', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const fonts = (document as Document & { fonts: FontFaceSet }).fonts
		if (!fonts) return
		try {
			Object.defineProperty(fonts, 'ready', {
				configurable: true,
				get: () =>
					new Promise<FontFaceSet>((resolve) => {
						setTimeout(() => resolve(fonts), 1500)
					}),
			})
		} catch {}
	})

	await page.reload()
	await expect(page.locator('.canvas')).toBeVisible()
	await expect(page.locator('.typographic-text')).toHaveCount(2)

	const worldTransform = () =>
		page.locator('[data-world-layer]').evaluate((element) => {
			const matrix = (element as SVGGElement).transform.baseVal.consolidate()?.matrix
			if (!matrix) throw new Error('Missing world transform')
			return { x: matrix.e, y: matrix.f, zoom: matrix.a }
		})
	const before = await worldTransform()

	await page.getByRole('button', { name: 'Reset view' }).click()
	await expect(page.locator('.canvas')).toHaveAttribute('data-initial-fit-ready', 'true')
	await page.waitForTimeout(1800)
	const after = await worldTransform()

	expect(after).toEqual(before)
})

test('overflow text is clickable and expands only the local selection frame', async ({
	page,
	request,
}) => {
	const geometry = await page
		.locator('[data-shape-id="eval-multiline-short"]')
		.evaluate((group) => {
			const foreignObject = group.querySelector('foreignObject') as SVGForeignObjectElement
			const div = foreignObject.querySelector('.typographic-text') as HTMLDivElement
			const foreignRect = foreignObject.getBoundingClientRect()
			const divRect = div.getBoundingClientRect()
			return {
				x: divRect.left + divRect.width / 2,
				y: (foreignRect.bottom + divRect.bottom) / 2,
				foreignBottom: foreignRect.bottom,
				divBottom: divRect.bottom,
			}
		})

	expect(geometry.divBottom).toBeGreaterThan(geometry.foreignBottom)
	await page.mouse.click(geometry.x, geometry.y)

	await expect(page.getByRole('region', { name: 'Selected object properties' })).toHaveAttribute(
		'data-selected-id',
		'eval-multiline-short',
	)
	await expect(
		page.locator('[data-shape-id="eval-multiline-short"] > rect.selection'),
	).toBeVisible()

	const selectionHeight = await page
		.locator('[data-shape-id="eval-multiline-short"] > rect.selection')
		.getAttribute('height')
	expect(Number(selectionHeight)).toBeGreaterThan(32)

	const saved = await board(request)
	const text = saved.shapes.find((shape) => shape.id === 'eval-multiline-short') as CanvasShape
	expect(text.h).toBe(24)
})
