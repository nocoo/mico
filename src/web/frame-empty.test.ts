import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldShowEmptyState } from './frame/empty/viewmodel.ts'

test('empty state appears only for a ready, empty and undismissed canvas', () => {
	assert.equal(shouldShowEmptyState('', 0, '', ''), false)
	assert.equal(shouldShowEmptyState('one', 0, '', ''), true)
	assert.equal(shouldShowEmptyState('one', 1, '', ''), false)
	assert.equal(shouldShowEmptyState('one', 0, 'one', ''), false)
	assert.equal(shouldShowEmptyState('two', 0, 'one', ''), true)
	assert.equal(shouldShowEmptyState('one', 0, '', 'draw'), false)
})
