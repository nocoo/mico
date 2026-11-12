import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Board, Shape } from '../../shared/types.ts'
import { transitionEntryAnimations } from './entry-animation.ts'

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

test('new supported objects enter while duplicate board events do not repeat them', () => {
	const previous = board(1, [rectangle])
	const next = board(2, [rectangle, text, connector])
	const entered = transitionEntryAnimations(previous, next, false, new Set(), new Set())
	assert.deepEqual([...entered], ['text', 'connector'])
	assert.deepEqual(
		[...transitionEntryAnimations(next, next, false, entered, new Set())],
		['text', 'connector'],
	)
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
