import assert from 'node:assert/strict'
import test from 'node:test'
import type { Board, CanvasShape, Shape } from '../../shared/types.ts'
import { CanvasHistory, HISTORY_LIMIT, HistoryConflict } from './history.ts'

const note = (id: string, text = id): CanvasShape => ({
	id,
	type: 'note',
	x: 10,
	y: 20,
	w: 200,
	h: 130,
	color: '#fff8d4',
	text,
})
const board = (...shapes: Shape[]): Board => ({ revision: 1, shapes })

function replay(history: CanvasHistory, current: Board, direction: 'undo' | 'redo'): Board {
	const operations = history.plan(current, direction)
	assert.ok(operations)
	let shapes = [...current.shapes]
	for (const operation of operations) {
		if (operation.type === 'delete') shapes = shapes.filter((shape) => shape.id !== operation.id)
		if (operation.type === 'restore') {
			shapes = shapes.filter((shape) => shape.id !== operation.shape.id)
			shapes.splice(operation.index, 0, operation.shape)
		}
	}
	history.complete(direction)
	return { revision: current.revision + 1, shapes }
}

test('history starts empty, records actual changes and preserves redo through no-ops', () => {
	const history = new CanvasHistory()
	assert.equal(history.canUndo, false)
	assert.equal(history.canRedo, false)
	assert.equal(history.plan(board(), 'undo'), null)
	history.record(board(), board(note('a')))
	const undone = replay(history, board(note('a')), 'undo')
	assert.deepEqual(undone.shapes, [])
	history.record(undone, { ...undone, revision: 20 })
	assert.equal(history.canRedo, true)
	assert.deepEqual(replay(history, undone, 'redo').shapes, [note('a')])
})

test('history retains exactly twenty edits across undo/redo and clears a branched future', () => {
	const history = new CanvasHistory()
	let current = board(note('a', '0'))
	for (let index = 1; index <= HISTORY_LIMIT + 1; index++) {
		const next = board(note('a', String(index)))
		history.record(current, next)
		current = next
	}
	for (let index = 0; index < HISTORY_LIMIT; index++) current = replay(history, current, 'undo')
	assert.equal(history.canUndo, false)
	assert.deepEqual(current.shapes, [note('a', '1')])
	for (let index = 0; index < HISTORY_LIMIT; index++) current = replay(history, current, 'redo')
	assert.equal(history.canRedo, false)
	current = replay(history, current, 'undo')
	history.record(current, board(note('a', 'branch')))
	assert.equal(history.canRedo, false)
})

test('history preserves unrelated foreign edits and exact optional fields', () => {
	const history = new CanvasHistory()
	const { text: _text, ...empty } = note('a')
	history.record(board(empty), board(note('a', 'typed')))
	const foreign = note('foreign')
	const undone = replay(history, board(note('a', 'typed'), foreign), 'undo')
	assert.deepEqual(undone.shapes, [empty, foreign])
	assert.deepEqual(replay(history, undone, 'redo').shapes, [note('a', 'typed'), foreign])
})

test('history rejects changes to affected objects without consuming the entry', () => {
	const history = new CanvasHistory()
	history.record(board(note('a')), board(note('a', 'local')))
	assert.throws(() => history.plan(board(note('a', 'foreign')), 'undo'), HistoryConflict)
	assert.equal(history.canUndo, true)
	assert.equal(history.canRedo, false)
	assert.throws(() => history.plan(board(), 'undo'), HistoryConflict)
})

test('undo cannot delete a new foreign connector or frame membership', () => {
	const history = new CanvasHistory()
	history.record(board(note('b')), board(note('b'), note('a')))
	assert.throws(
		() =>
			history.plan(
				board(note('b'), note('a'), {
					id: 'foreign-edge',
					type: 'connector',
					from: 'a',
					to: 'b',
					color: '#00a2e1',
				}),
				'undo',
			),
		/depends/,
	)
	const frame: CanvasShape = { ...note('frame'), type: 'frame', title: 'Group' }
	delete frame.text
	const frames = new CanvasHistory()
	frames.record(board(), board(frame))
	assert.throws(
		() => frames.plan(board(frame, { ...note('foreign'), frameId: 'frame' }), 'undo'),
		/depends/,
	)
})

test('undo restores deleted objects in their original order around foreign objects', () => {
	const history = new CanvasHistory()
	const before = board(note('a'), note('b'), note('c'))
	const after = board(note('b'))
	history.record(before, after)
	const restored = replay(history, board(note('b'), note('foreign')), 'undo')
	assert.deepEqual(
		restored.shapes.map((shape) => shape.id),
		['a', 'b', 'c', 'foreign'],
	)
	assert.deepEqual(
		replay(history, restored, 'redo').shapes.map((shape) => shape.id),
		['b', 'foreign'],
	)
})

test('undo does not resurrect connectors whose other endpoint was deleted elsewhere', () => {
	const history = new CanvasHistory()
	const edge: Shape = { id: 'edge', type: 'connector', from: 'a', to: 'b', color: '#00a2e1' }
	history.record(board(note('a'), note('b'), edge), board(note('b')))
	assert.throws(() => history.plan(board(), 'undo'), /no longer exists/)
})

test('recorded entries are immutable and compare values rather than JSON key order', () => {
	const history = new CanvasHistory()
	const after = note('a', 'new')
	history.record(board(note('a')), board(after))
	after.text = 'mutated'
	const reordered = Object.fromEntries(
		Object.entries(note('a', 'new')).reverse(),
	) as unknown as Shape
	assert.ok(history.plan(board(reordered), 'undo'))
	assert.throws(() => history.plan(board(after), 'undo'), HistoryConflict)
})

test('separate browser canvas histories do not share entries', () => {
	const first = new CanvasHistory()
	const second = new CanvasHistory()
	first.record(board(), board(note('a')))
	assert.equal(first.canUndo, true)
	assert.equal(second.canUndo, false)
})
