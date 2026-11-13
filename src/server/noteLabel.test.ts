import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NOTE_LABEL_SPACE, noteLabelHeightDelta } from '../shared/noteLayout.ts'
import type { Board, CanvasShape } from '../shared/types.ts'
import { CanvasHistory } from '../web/canvas/history.ts'
import { createCanvasTools } from './aiTools.ts'
import { BoardStore, OperationError } from './store.ts'

const NOTE_COLOR = '#fff8d4'
const BLUE = '#00a2e1'
const toolRun = (tool: unknown, input: unknown) =>
	(tool as { execute: (value: unknown, options: unknown) => Promise<unknown> }).execute(input, {
		toolCallId: 'note-label-test',
		messages: [],
	})

function withStore(run: (store: BoardStore) => Promise<void> | void): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-note-label-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	return Promise.resolve(run(store)).finally(() => {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	})
}

function note(id: string, values: Partial<CanvasShape> = {}): CanvasShape {
	return {
		id,
		type: 'note',
		x: 100,
		y: 100,
		w: 260,
		h: 140,
		color: NOTE_COLOR,
		text: 'One\nTwo\nThree\nFour\nFive',
		...values,
	}
}

function frame(id: string, values: Partial<CanvasShape> = {}): CanvasShape {
	return {
		id,
		type: 'frame',
		x: 68,
		y: 68,
		w: 324,
		h: 204,
		color: BLUE,
		title: id,
		...values,
	}
}

function shapeOf(board: Board, id: string): CanvasShape {
	const shape = board.shapes.find((candidate) => candidate.id === id)
	assert.ok(shape)
	if (shape.type === 'connector') throw new Error(`Expected canvas shape ${id}`)
	return shape
}

function replay(store: BoardStore, history: CanvasHistory, direction: 'undo' | 'redo'): Board {
	const current = store.getBoard()
	const operations = history.plan(current, direction)
	assert.ok(operations)
	const next = store.apply({ operations, expectedRevision: current.revision })
	history.complete(direction)
	return next
}

test('shared note label layout compensates only visibility transitions', () => {
	assert.equal(NOTE_LABEL_SPACE, 19)
	assert.equal(noteLabelHeightDelta(undefined, 'Risk'), 19)
	assert.equal(noteLabelHeightDelta('', 'Risk'), 19)
	assert.equal(noteLabelHeightDelta('Risk', 'Decision'), 0)
	assert.equal(noteLabelHeightDelta('Risk', ''), -19)
	assert.equal(noteLabelHeightDelta(undefined, undefined), 0)
})

test('store compensates note labels atomically, idempotently and reversibly', () =>
	withStore((store) => {
		const created = store.apply({ operations: [{ type: 'create', shape: note('note') }] })
		const labelled = store.apply({
			operations: [{ type: 'update', id: 'note', patch: { label: 'Risk' } }],
		})
		assert.equal(shapeOf(labelled, 'note').type === 'note' ? shapeOf(labelled, 'note').h : 0, 159)
		assert.equal(labelled.revision, created.revision + 1)

		const repeated = store.apply({
			operations: [{ type: 'update', id: 'note', patch: { label: 'Risk' } }],
		})
		const repeatedNote = shapeOf(repeated, 'note')
		assert.equal(repeatedNote.type === 'note' ? repeatedNote.h : 0, 159)

		const cleared = store.apply({
			operations: [{ type: 'update', id: 'note', patch: { label: '' } }],
		})
		assert.equal(shapeOf(cleared, 'note').type === 'note' ? shapeOf(cleared, 'note').h : 0, 140)

		const relabelled = store.apply({
			operations: [{ type: 'update', id: 'note', patch: { label: 'Decision' } }],
		})
		assert.equal(
			shapeOf(relabelled, 'note').type === 'note' ? shapeOf(relabelled, 'note').h : 0,
			159,
		)

		const explicit = store.apply({
			operations: [{ type: 'update', id: 'note', patch: { label: 'Explicit', h: 170 } }],
		})
		assert.equal(shapeOf(explicit, 'note').type === 'note' ? shapeOf(explicit, 'note').h : 0, 170)
		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'update', id: 'note', patch: { label: 'Too small', h: 49 } }],
				}),
			(error: unknown) =>
				error instanceof OperationError &&
				error.status === 400 &&
				/at least 50/.test(error.message),
		)

		for (const h of [0, 20]) {
			const id = `tiny-${h}`
			const tiny = store.apply({ operations: [{ type: 'create', shape: note(id, { h }) }] })
			assert.throws(
				() => store.apply({ operations: [{ type: 'update', id, patch: { label: 'Risk' } }] }),
				(error: unknown) =>
					error instanceof OperationError &&
					error.status === 400 &&
					/at least 50/.test(error.message),
			)
			assert.deepEqual(store.getBoard(), tiny)
		}
	}))

test('store preserves 32px containment and grows only an escaped frame edge', () =>
	withStore((store) => {
		const before = store.apply({
			operations: [
				{ type: 'create', shape: frame('frame', { x: 68, y: 68, w: 324, h: 204 }) },
				{ type: 'create', shape: note('contained', { x: 100, y: 100, h: 140, frameId: 'frame' }) },
			],
		})
		const contained = store.apply({
			operations: [{ type: 'update', id: 'contained', patch: { label: 'Still inside' } }],
		})
		const containedFrame = shapeOf(contained, 'frame')
		assert.equal(containedFrame.type === 'frame' ? containedFrame.h : 0, 204)
		assert.deepEqual(
			containedFrame.type === 'frame'
				? { x: containedFrame.x, y: containedFrame.y, w: containedFrame.w, h: containedFrame.h }
				: null,
			shapeOf(before, 'frame').type === 'frame'
				? {
						x: shapeOf(before, 'frame').x,
						y: shapeOf(before, 'frame').y,
						w: shapeOf(before, 'frame').w,
						h: shapeOf(before, 'frame').h,
					}
				: null,
		)

		store.apply({
			operations: [{ type: 'update', id: 'frame', patch: { h: 172 } }],
		})
		const escaped = store.apply({
			operations: [{ type: 'update', id: 'contained', patch: { label: '' } }],
		})
		assert.equal(
			shapeOf(escaped, 'contained').type === 'note' ? shapeOf(escaped, 'contained').h : 0,
			140,
		)
		const regrown = store.apply({
			operations: [{ type: 'update', id: 'contained', patch: { label: 'Escape' } }],
		})
		const grownFrame = shapeOf(regrown, 'frame')
		assert.equal(grownFrame.type === 'frame' ? grownFrame.h : 0, 231)
	}))

test('store rejects note and frame collisions atomically, but accepts a blocker moved in the batch', () =>
	withStore((store) => {
		const initial = store.apply({
			operations: [
				{ type: 'create', shape: frame('frame', { x: 0, y: 0, w: 400, h: 300 }) },
				{ type: 'create', shape: note('member', { x: 40, y: 150, h: 150, frameId: 'frame' }) },
				{
					type: 'create',
					shape: note('sibling', { x: 150, y: 305, w: 30, h: 30, frameId: 'frame' }),
				},
				{ type: 'create', shape: note('external', { x: 350, y: 330, w: 40, h: 60 }) },
			],
		})
		assert.throws(
			() =>
				store.apply({ operations: [{ type: 'update', id: 'member', patch: { label: 'Risk' } }] }),
			(error: unknown) =>
				error instanceof OperationError &&
				['NOTE_LABEL_COLLISION', 'FRAME_COLLISION'].includes(error.code),
		)
		assert.deepEqual(store.getBoard(), initial)

		const moved = store.apply({
			operations: [
				{ type: 'update', id: 'member', patch: { label: 'Risk' } },
				{ type: 'update', id: 'sibling', patch: { y: 400 } },
				{ type: 'update', id: 'external', patch: { y: 500 } },
			],
		})
		assert.equal(
			shapeOf(moved, 'member').type === 'note' ? shapeOf(moved, 'member').label : undefined,
			'Risk',
		)
	}))

test('store ignores a note own connector while checking label growth and merges frame growth', () =>
	withStore((store) => {
		store.apply({
			operations: [
				{ type: 'create', shape: frame('frame', { x: 0, y: 0, w: 500, h: 400 }) },
				{ type: 'create', shape: note('first', { x: 40, y: 232, h: 159, frameId: 'frame' }) },
				{
					type: 'create',
					shape: note('second', { x: 340, y: 222, w: 100, h: 160, frameId: 'frame' }),
				},
				{
					type: 'create',
					shape: {
						id: 'edge',
						type: 'connector',
						from: 'first',
						to: 'second',
						fromAnchor: 7,
						toAnchor: 6,
						color: BLUE,
					},
				},
			],
		})
		const grown = store.apply({
			operations: [
				{ type: 'update', id: 'first', patch: { label: 'First' } },
				{ type: 'update', id: 'second', patch: { label: 'Second' } },
			],
		})
		const grownFrame = shapeOf(grown, 'frame')
		assert.equal(grownFrame.type === 'frame' ? grownFrame.y : 0, 0)
		assert.equal(grownFrame.type === 'frame' ? grownFrame.h : 0, 450)
		assert.equal(grownFrame.type === 'frame' ? grownFrame.w : 0, 500)
	}))

test('history restores compensated note and frame geometry without reapplying growth', () =>
	withStore((store) => {
		const before = store.apply({
			operations: [
				{ type: 'create', shape: frame('frame', { x: 0, y: 0, w: 400, h: 160 }) },
				{ type: 'create', shape: note('member', { x: 40, y: 20, h: 140, frameId: 'frame' }) },
			],
		})
		const after = store.apply({
			operations: [{ type: 'update', id: 'member', patch: { label: 'Action' } }],
		})
		const history = new CanvasHistory()
		history.record(before, after)
		assert.deepEqual(replay(store, history, 'undo').shapes, before.shapes)
		assert.deepEqual(replay(store, history, 'redo').shapes, after.shapes)
	}))

test('AI add_notes preserves omitted dimensions for existing ids and reserves label space on create', () =>
	withStore(async (store) => {
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: store.getActiveCanvasId(),
		})
		store.apply({ operations: [{ type: 'create', shape: note('existing', { h: 227 }) }] })
		await toolRun(tools.get_board, {})
		const updated = (await toolRun(tools.add_notes, {
			notes: [{ id: 'existing', x: 140, y: 120, text: 'Updated', label: 'AI label' }],
		})) as { ok: boolean }
		assert.equal(updated.ok, true)
		const existing = shapeOf(store.getBoard(), 'existing')
		assert.equal(existing.type === 'note' ? existing.h : 0, 246)
		assert.equal(existing.type === 'note' ? existing.x : 0, 140)

		await toolRun(tools.get_board, {})
		const explicit = (await toolRun(tools.add_notes, {
			notes: [{ id: 'existing', x: 140, y: 120, h: 260, text: 'Explicit', label: 'Changed label' }],
		})) as { ok: boolean }
		assert.equal(explicit.ok, true)
		assert.equal(
			shapeOf(store.getBoard(), 'existing').type === 'note'
				? shapeOf(store.getBoard(), 'existing').h
				: 0,
			260,
		)

		const created = (await toolRun(tools.add_notes, {
			notes: [{ id: 'new-labelled', x: 500, y: 100, text: 'New', label: 'New' }],
		})) as { ok: boolean }
		assert.equal(created.ok, true)
		assert.equal(
			shapeOf(store.getBoard(), 'new-labelled').type === 'note'
				? shapeOf(store.getBoard(), 'new-labelled').h
				: 0,
			180 + NOTE_LABEL_SPACE,
		)
	}))
