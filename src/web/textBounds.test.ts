import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Shape } from '../shared/types.ts'
import { deriveTextBounds } from './textBounds.ts'

const text: Shape = {
	id: 'heading"] [data-shape-id="other',
	type: 'text',
	x: 160,
	y: 260,
	w: 180,
	h: 24,
	color: '#242a38',
	text: 'three\nlines',
	fontSize: 32,
}

function rootWith(height: number, id = text.id): ParentNode {
	return {
		querySelectorAll: () => [{ scrollHeight: height, closest: () => ({ getAttribute: () => id }) }],
	} as unknown as ParentNode
}

test('text bounds grow to visible content without mutating persisted geometry', () => {
	const shapes = Object.freeze([Object.freeze(text)])
	assert.deepEqual(deriveTextBounds(shapes, rootWith(74)), [{ ...text, h: 74 }])
	assert.equal(text.h, 24)
})

test('wide glyph overflow contributes actual horizontal derived bounds', () => {
	const wide: Shape = {
		id: 'wide',
		type: 'text',
		x: 160,
		y: 260,
		w: 8,
		h: 24,
		color: '#242424',
		text: '中',
		fontSize: 48,
	}
	const elements = [
		{
			scrollHeight: 55,
			scrollWidth: 48,
			closest: () => ({ getAttribute: () => 'wide' }),
			getBoundingClientRect: () => ({
				left: 160,
				top: 260,
				right: 168,
				bottom: 284,
				width: 8,
				height: 24,
			}),
			ownerDocument: {
				createRange: () => ({
					selectNodeContents: () => undefined,
					getBoundingClientRect: () => ({ left: 160, top: 260, right: 208, bottom: 315 }),
				}),
			},
		},
	]
	const root = { querySelectorAll: () => elements } as unknown as ParentNode

	const original = Object.freeze(Object.freeze(wide))
	const derived = deriveTextBounds([original], root)

	assert.deepEqual(derived, [{ ...wide, w: 48, h: 55 }])
	assert.notStrictEqual(derived[0], original)
	assert.equal(original.w, 8)
	assert.equal(original.h, 24)
})

test('overflowing rectangle and ellipse labels contribute rendered bounds without mutating shapes', () => {
	const rectangle: Shape = {
		id: 'label-rect',
		type: 'rectangle',
		x: 100,
		y: 100,
		w: 80,
		h: 40,
		color: '#242424',
		text: 'Supercalifragilisticexpialidocious',
		fontSize: 256,
	}
	const ellipse: Shape = {
		id: 'label-ellipse',
		type: 'ellipse',
		x: 300,
		y: 100,
		w: 80,
		h: 40,
		color: '#242424',
		text: '👨‍👩‍👧‍👦 中文',
		fontSize: 64,
	}
	const elements = [rectangle, ellipse].map((shape) => {
		const width = shape.type === 'ellipse' ? shape.w / Math.SQRT2 - 24 : shape.w - 24
		const height = shape.type === 'ellipse' ? shape.h / Math.SQRT2 - 24 : shape.h - 24
		const labelX = shape.x + (shape.w - width) / 2
		const labelY = shape.y + (shape.h - height) / 2
		return {
			closest: (selector: string) =>
				selector === 'foreignObject' ? null : { getAttribute: () => shape.id },
			getBoundingClientRect: () => ({
				left: labelX,
				top: labelY,
				right: labelX + width,
				bottom: labelY + height,
				width,
				height,
			}),
			ownerDocument: {
				createRange: () => ({
					selectNodeContents: () => undefined,
					getBoundingClientRect: () => ({
						left: shape.x - 20,
						top: shape.y - 10,
						right: shape.x + shape.w + 20,
						bottom: shape.y + shape.h + 10,
					}),
				}),
			},
		}
	})
	const root = { querySelectorAll: () => elements } as unknown as ParentNode
	const original = Object.freeze([Object.freeze(rectangle), Object.freeze(ellipse)])
	const derived = deriveTextBounds(original, root)

	assert.deepEqual(derived[0], { ...rectangle, x: 80, y: 90, w: 120, h: 60 })
	assert.deepEqual(derived[1], { ...ellipse, x: 280, y: 90, w: 120, h: 60 })
	assert.equal(rectangle.x, 100)
	assert.equal(ellipse.x, 300)
})

test('absent, shorter and nonfinite measurements keep the stored box', () => {
	for (const root of [null, rootWith(12), rootWith(Number.NaN), rootWith(100, 'other')]) {
		assert.deepEqual(deriveTextBounds([text], root), [text])
	}
})
