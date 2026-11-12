import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	appendCompletedTranscript,
	buildAssistantRequestBody,
	DEFAULT_ASSISTANT_TAB,
	deriveAssistantActivity,
	initialAssistantTab,
	nextAssistantTab,
	shouldCloseAssistantEscape,
	shouldConsumeInitialPrompt,
	shouldRestoreAssistantTriggerFocus,
	takeLectureBatch,
} from './frame/assistant/protocol.ts'

test('assistant tab keyboard protocol opens recordings and reaches endpoints', () => {
	assert.equal(DEFAULT_ASSISTANT_TAB, 'audio')
	assert.equal(initialAssistantTab(''), 'audio')
	assert.equal(initialAssistantTab('Draw a diagram'), 'chat')
	assert.equal(nextAssistantTab('chat', 'ArrowLeft'), 'settings')
	assert.equal(nextAssistantTab('settings', 'ArrowRight'), 'chat')
	assert.equal(nextAssistantTab('chat', 'ArrowRight'), 'audio')
	assert.equal(nextAssistantTab('audio', 'ArrowRight'), 'live')
	assert.equal(nextAssistantTab('live', 'ArrowRight'), 'settings')
	assert.equal(nextAssistantTab('live', 'Home'), 'chat')
	assert.equal(nextAssistantTab('chat', 'End'), 'settings')
})

test('final live transcript remains readable across completed segments', () => {
	assert.equal(
		appendCompletedTranscript('', 'The source has internal resistance.'),
		'The source has internal resistance.',
	)
	assert.equal(
		appendCompletedTranscript('The source has internal resistance.', 'The terminal voltage falls.'),
		'The source has internal resistance. The terminal voltage falls.',
	)
	assert.equal(appendCompletedTranscript('Existing transcript', '  '), 'Existing transcript')
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
	const pointerInside = false
	assert.equal(shouldCloseAssistantEscape('Escape', false, pointerInside, false), false)
	assert.equal(shouldCloseAssistantEscape('Escape', false, true, false), true)
	assert.equal(shouldCloseAssistantEscape('Escape', false, pointerInside, true), true)
	assert.equal(shouldCloseAssistantEscape('Escape', true, true, true), false)
	assert.equal(shouldCloseAssistantEscape('Enter', false, true, true), false)
})

test('assistant status reports only real session and connection state', () => {
	const base = {
		error: false,
		busy: false,
		summaryRequesting: false,
		lectureQueued: 0,
		connectionStatus: 'live' as const,
	}
	assert.deepEqual(deriveAssistantActivity(base), { state: 'idle', text: 'Mico is ready' })
	assert.deepEqual(deriveAssistantActivity({ ...base, busy: true }), {
		state: 'work',
		text: 'Mico is drawing…',
	})
	assert.deepEqual(deriveAssistantActivity({ ...base, lectureQueued: 2 }), {
		state: 'work',
		text: '2 segments queued',
	})
	assert.deepEqual(deriveAssistantActivity({ ...base, connectionStatus: 'offline' }), {
		state: 'offline',
		text: 'Mico is offline',
	})
})

test('trigger focus and initial prompt consume only after real lifecycle transitions', () => {
	assert.equal(shouldRestoreAssistantTriggerFocus(true, false), true)
	assert.equal(shouldRestoreAssistantTriggerFocus(false, false), false)
	assert.equal(shouldRestoreAssistantTriggerFocus(true, true), false)
	assert.equal(shouldConsumeInitialPrompt(true, '  Draw a titration  '), true)
	assert.equal(shouldConsumeInitialPrompt(false, 'Draw a titration'), false)
	assert.equal(shouldConsumeInitialPrompt(true, '   '), false)
})
