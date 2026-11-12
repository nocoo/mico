import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Board, Shape } from '../../shared/types.ts'
import {
	clearEntrySuppression,
	clearObservedEntrySuppressions,
	clearReducedMotionEntries,
	type EntrySuppressionRegistry,
	entryAnimationCompleted,
	suppressEntryAnimation,
	suppressedEntryIds,
	transitionEntryAnimations,
} from './entry-animation.ts'

const rectangle: Shape = {
	id: 'rectangle',
	type: 'rectangle',
	x: 0,
	y: 0,
	w: 100,
	h: 80,
	color: '#00a2e1',
}
const text: Shape = {
	id: 'text',
	type: 'text',
	x: 120,
	y: 0,
	w: 100,
	h: 40,
	color: '#2b3038',
}
const connector: Shape = {
	id: 'connector',
	type: 'connector',
	from: 'rectangle',
	to: 'text',
	color: '#00a2e1',
}
const board = (revision: number, shapes: Shape[]): Board => ({ revision, shapes })

test('old shapes and property updates do not enter', () => {
	const previous = board(1, [rectangle, connector])
	const updated = board(2, [{ ...rectangle, text: 'Updated' }, connector])
	assert.deepEqual(
		[...transitionEntryAnimations(previous, updated, false, new Set(), new Set())],
		[],
	)
})

test('new supported objects stay active across rerenders and duplicate board events', () => {
	const previous = board(1, [rectangle])
	const next = board(2, [rectangle, text, connector])
	const entered = transitionEntryAnimations(previous, next, false, new Set(), new Set())
	assert.deepEqual([...entered], ['text', 'connector'])
	assert.deepEqual(
		[...transitionEntryAnimations(next, next, false, entered, new Set())],
		['text', 'connector'],
	)
})

test('only the final connector fade and pop animation complete entry state', () => {
	assert.equal(entryAnimationCompleted('pop', 'canvas-entry-pop'), true)
	assert.equal(entryAnimationCompleted('pop', 'canvas-edge-fade-in'), false)
	assert.equal(entryAnimationCompleted('draw', 'canvas-edge-fade-in'), true)
	assert.equal(entryAnimationCompleted('draw', 'canvas-edge-draw'), false)
})

test('reduced motion clears active non-note classes without touching note animation state', () => {
	const note: Shape = { ...rectangle, id: 'note', type: 'note' }
	const active = new Set(['rectangle', 'note', 'connector'])
	assert.equal(clearReducedMotionEntries(active, [rectangle, note, connector]), true)
	assert.deepEqual([...active], ['note'])
	assert.equal(clearReducedMotionEntries(active, [note]), false)
})

test('initial load and canvas switch clear entry animations', () => {
	const old = board(1, [rectangle])
	const next = board(2, [rectangle, text])
	assert.deepEqual(
		[...transitionEntryAnimations(old, next, true, new Set(['rectangle']), new Set())],
		[],
	)
})

test('manual rectangle and ellipse creations are suppressed', () => {
	const ellipse: Shape = { ...rectangle, id: 'ellipse', type: 'ellipse' }
	const next = board(2, [rectangle, ellipse])
	const entered = transitionEntryAnimations(
		board(1, []),
		next,
		false,
		new Set(),
		new Set(['rectangle', 'ellipse']),
	)
	assert.deepEqual([...entered], [])
})

test('manual suppression cleanup is token-safe across failed cross-canvas creates', () => {
	const registry: EntrySuppressionRegistry = new Map()
	const first = Symbol('first')
	const second = Symbol('second')
	suppressEntryAnimation(registry, 'canvas-a', rectangle.id, first)
	suppressEntryAnimation(registry, 'canvas-b', rectangle.id, second)

	clearEntrySuppression(registry, 'canvas-a', rectangle.id, Symbol('stale'))
	assert.deepEqual([...suppressedEntryIds(registry, 'canvas-a')], [rectangle.id])
	clearEntrySuppression(registry, 'canvas-a', rectangle.id, first)
	assert.deepEqual([...suppressedEntryIds(registry, 'canvas-a')], [])
	assert.deepEqual([...suppressedEntryIds(registry, 'canvas-b')], [rectangle.id])
})

test('observed manual creates remove only their canvas suppression', () => {
	const registry: EntrySuppressionRegistry = new Map()
	suppressEntryAnimation(registry, 'canvas-a', rectangle.id, Symbol('a'))
	suppressEntryAnimation(registry, 'canvas-b', rectangle.id, Symbol('b'))
	clearObservedEntrySuppressions(registry, 'canvas-a', [rectangle])
	assert.deepEqual([...suppressedEntryIds(registry, 'canvas-a')], [])
	assert.deepEqual([...suppressedEntryIds(registry, 'canvas-b')], [rectangle.id])
})

test('removed entry ids are cleared so a later recreation can animate', () => {
	const entered = new Set(['text'])
	assert.deepEqual(
		[...transitionEntryAnimations(board(1, [text]), board(2, []), false, entered, new Set())],
		[],
	)
	assert.deepEqual(
		[...transitionEntryAnimations(board(2, []), board(3, [text]), false, new Set(), new Set())],
		['text'],
	)
})
