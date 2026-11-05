import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	buildAssistantRequestBody,
	nextAssistantTab,
	shouldCloseAssistantEscape,
	shouldConsumeInitialPrompt,
	shouldRestoreAssistantTriggerFocus,
	takeLectureBatch,
} from './frame/assistant/protocol.ts'

test('assistant tab keyboard protocol wraps and reaches endpoints', () => {
	assert.equal(nextAssistantTab('chat', 'ArrowLeft'), 'settings')
	assert.equal(nextAssistantTab('settings', 'ArrowRight'), 'chat')
	assert.equal(nextAssistantTab('chat', 'ArrowRight'), 'audio')
	assert.equal(nextAssistantTab('audio', 'ArrowRight'), 'live')
	assert.equal(nextAssistantTab('live', 'ArrowRight'), 'settings')
	assert.equal(nextAssistantTab('live', 'Home'), 'chat')
	assert.equal(nextAssistantTab('chat', 'End'), 'settings')
})

test('lecture batches preserve count and character limits', () => {
	const queue = ['one', 'two', 'three', 'four']
	assert.deepEqual(takeLectureBatch(queue, 3, 900), {
		batch: ['one', 'two', 'three'],
		remaining: ['four'],
	})
	assert.deepEqual(takeLectureBatch(['abc', 'x'.repeat(898), 'tail'], 3, 900), {
		batch: ['abc'],
		remaining: ['x'.repeat(898), 'tail'],
	})
	assert.deepEqual(takeLectureBatch([]), { batch: [], remaining: [] })
})

test('assistant requests carry selection, mode and active canvas', () => {
	assert.deepEqual(buildAssistantRequestBody(['shape-a', 'shape-b'], 'chat', 'canvas-1'), {
		selection: ['shape-a', 'shape-b'],
		mode: 'chat',
		canvasId: 'canvas-1',
	})
	assert.deepEqual(buildAssistantRequestBody([], 'lecture', ''), {
		selection: [],
		mode: 'lecture',
	})
})

test('Escape closes only from an assistant interaction context', () => {
	assert.equal(shouldCloseAssistantEscape('Escape', false, true, false), true)
	assert.equal(shouldCloseAssistantEscape('Escape', false, false, true), true)
	assert.equal(shouldCloseAssistantEscape('Escape', true, true, true), false)
	assert.equal(shouldCloseAssistantEscape('Enter', false, true, true), false)
	assert.equal(shouldCloseAssistantEscape('Escape', false, false, false), false)
})

test('trigger focus and initial prompt consume only after real lifecycle transitions', () => {
	assert.equal(shouldRestoreAssistantTriggerFocus(true, false), true)
	assert.equal(shouldRestoreAssistantTriggerFocus(false, false), false)
	assert.equal(shouldRestoreAssistantTriggerFocus(true, true), false)
	assert.equal(shouldConsumeInitialPrompt(true, '  Draw a titration  '), true)
	assert.equal(shouldConsumeInitialPrompt(false, 'Draw a titration'), false)
	assert.equal(shouldConsumeInitialPrompt(true, '   '), false)
})
