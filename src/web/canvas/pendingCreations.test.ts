import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Board, CanvasShape } from '../../shared/types.ts'
import {
	beginPendingCreation,
	clearPendingCreations,
	markConfirmed,
	markUncertain,
	reconcilePendingCreations,
} from './pendingCreations.ts'

const shape = (id: string): CanvasShape => ({
	id,
	type: 'rectangle',
	x: 0,
	y: 0,
	w: 20,
	h: 20,
	color: '#3b82f6',
})

const board = (...shapes: CanvasShape[]): Board => ({ revision: 1, shapes })

test('beginPendingCreation adds an entry in the pending state', () => {
	const entries = beginPendingCreation(new Map(), shape('a'))
	assert.equal(entries.size, 1)
	assert.deepEqual(entries.get('a'), { shape: shape('a'), state: 'pending' })
})

test('beginPendingCreation replaces an existing entry for the same id', () => {
	const entries = beginPendingCreation(beginPendingCreation(new Map(), shape('a')), shape('a'))
	assert.equal(entries.size, 1)
	assert.deepEqual(entries.get('a'), { shape: shape('a'), state: 'pending' })
})

test('markConfirmed drops the entry and stays idempotent', () => {
	const entries = beginPendingCreation(new Map(), shape('a'))
	const confirmed = markConfirmed(entries, 'a')
	assert.equal(confirmed.size, 0)
	assert.equal(markConfirmed(confirmed, 'a').size, 0)
	const untouched = markConfirmed(entries, 'missing')
	assert.equal(untouched, entries)
})

test('markUncertain keeps the shape and flips only the state', () => {
	const entries = beginPendingCreation(new Map(), shape('a'))
	const uncertain = markUncertain(entries, 'a')
	assert.deepEqual(uncertain.get('a'), { shape: shape('a'), state: 'uncertain' })
	assert.equal(markUncertain(uncertain, 'a').get('a')?.state, 'uncertain')
	assert.equal(markUncertain(entries, 'missing'), entries)
})

test('reconcilePendingCreations drops entries the board now contains', () => {
	const entries = beginPendingCreation(beginPendingCreation(new Map(), shape('a')), shape('b'))
	const reconciled = reconcilePendingCreations(entries, board(shape('b')))
	assert.equal(reconciled.has('a'), true)
	assert.equal(reconciled.has('b'), false)
	assert.equal(reconcilePendingCreations(reconciled, board()).has('a'), true)
})

test('clearPendingCreations empties every entry', () => {
	const entries = beginPendingCreation(beginPendingCreation(new Map(), shape('a')), shape('b'))
	assert.equal(clearPendingCreations().size, 0)
	assert.notEqual(clearPendingCreations(), entries)
})
