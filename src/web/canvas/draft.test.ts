import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasShape } from '../../shared/types.ts'
import { beginDraft, finalizeDraft, updateDraft } from './draft.ts'

const start = { x: 100, y: 80 }

function drafted(kind: 'rectangle' | 'ellipse' | 'line'): CanvasShape {
	return beginDraft({ id: 'draft-1', kind, start, color: '#3b82f6' })
}

test('beginDraft anchors a zero-size draft at the start point', () => {
	for (const kind of ['rectangle', 'ellipse', 'line'] as const) {
		const draft = drafted(kind)
		assert.equal(draft.id, 'draft-1')
		assert.equal(draft.type, kind)
		assert.deepEqual(
			{ x: draft.x, y: draft.y, w: draft.w, h: draft.h },
			{ x: 100, y: 80, w: 0, h: 0 },
		)
		assert.equal(draft.color, '#3b82f6')
	}
})

test('updateDraft normalizes every drag direction for boxes', () => {
	const draft = drafted('rectangle')
	for (const [pointer, expected] of [
		[
			{ x: 160, y: 140 },
			{ x: 100, y: 80, w: 60, h: 60 },
		],
		[
			{ x: 40, y: 20 },
			{ x: 40, y: 20, w: 60, h: 60 },
		],
		[
			{ x: 160, y: 20 },
			{ x: 100, y: 20, w: 60, h: 60 },
		],
		[
			{ x: 40, y: 140 },
			{ x: 40, y: 80, w: 60, h: 60 },
		],
	] as const) {
		const next = updateDraft(draft, start, pointer)
		assert.deepEqual({ x: next.x, y: next.y, w: next.w, h: next.h }, expected)
	}
})

test('updateDraft keeps signed offsets for lines', () => {
	const draft = drafted('line')
	for (const [pointer, expected] of [
		[
			{ x: 160, y: 140 },
			{ w: 60, h: 60 },
		],
		[
			{ x: 40, y: 140 },
			{ w: -60, h: 60 },
		],
		[
			{ x: 160, y: 20 },
			{ w: 60, h: -60 },
		],
		[
			{ x: 40, y: 20 },
			{ w: -60, h: -60 },
		],
	] as const) {
		const next = updateDraft(draft, start, pointer)
		assert.deepEqual({ x: next.x, y: next.y, w: next.w, h: next.h }, { x: 100, y: 80, ...expected })
	}
})

test('updateDraft preserves identity fields across updates', () => {
	const draft = drafted('ellipse')
	const next = updateDraft(draft, start, { x: 130, y: 20 })
	assert.equal(next.id, draft.id)
	assert.equal(next.type, 'ellipse')
	assert.equal(next.color, draft.color)
})

test('finalizeDraft rejects drafts below the eight unit threshold', () => {
	const rectangle = drafted('rectangle')
	assert.equal(finalizeDraft(rectangle, start, { x: 107, y: 87 }), null)
	assert.equal(finalizeDraft(rectangle, start, { x: 93, y: 73 }), null)
	assert.notEqual(finalizeDraft(rectangle, start, { x: 108, y: 108 }), null)
	assert.notEqual(finalizeDraft(rectangle, start, { x: 130, y: 84 }), null)
})

test('finalizeDraft clamps box edges to the minimum size and keeps lines signed', () => {
	const rectangle = drafted('rectangle')
	const wide = finalizeDraft(rectangle, start, { x: 200, y: 87 })
	assert.ok(wide)
	assert.deepEqual({ x: wide.x, y: wide.y, w: wide.w, h: wide.h }, { x: 100, y: 80, w: 100, h: 8 })
	const negative = finalizeDraft(rectangle, start, { x: 20, y: 86 })
	assert.ok(negative)
	assert.deepEqual(
		{ x: negative.x, y: negative.y, w: negative.w, h: negative.h },
		{ x: 20, y: 80, w: 80, h: 8 },
	)

	const line = drafted('line')
	const diagonal = finalizeDraft(line, start, { x: 40, y: 160 })
	assert.ok(diagonal)
	assert.deepEqual({ w: diagonal.w, h: diagonal.h }, { w: -60, h: 80 })
	const longLine = finalizeDraft(line, start, { x: 107, y: 200 })
	assert.ok(longLine)
	assert.deepEqual({ w: longLine.w, h: longLine.h }, { w: 7, h: 120 })
})
