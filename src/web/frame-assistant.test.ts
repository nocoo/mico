import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as protocol from './frame/assistant/protocol.ts'
import {
	appendCompletedTranscript,
	assistantTabs,
	buildAssistantRequestBody,
	DEFAULT_ASSISTANT_TAB,
	deriveAssistantActivity,
	nextAssistantTab,
	resolveAssistantTab,
	shouldCloseAssistantEscape,
	shouldConsumeInitialPrompt,
	shouldFocusComposer,
	shouldRestoreAssistantTriggerFocus,
	summaryToolsCompleted,
	takeLectureBatch,
} from './frame/assistant/protocol.ts'
import * as micVm from './frame/assistant/useMicrophoneViewModel.ts'

test('summary requires successful HTML and action card results', () => {
	const html = {
		type: 'tool-add_html_cards' as const,
		toolCallId: 'html',
		state: 'output-available' as const,
		input: { cards: [] },
		output: { ok: true },
	}
	const actions = {
		type: 'tool-upsert_action_card' as const,
		toolCallId: 'actions',
		state: 'output-available' as const,
		input: { items: [] },
		output: { ok: true },
	}
	assert.equal(summaryToolsCompleted([html]), false)
	assert.equal(summaryToolsCompleted([actions]), false)
	assert.equal(summaryToolsCompleted([html, actions]), true)
	assert.equal(summaryToolsCompleted([html, { ...actions, output: { ok: false } }]), false)
	assert.equal(summaryToolsCompleted([{ ...html, output: { ok: false } }, actions]), false)
	assert.equal(summaryToolsCompleted([html, actions, { ...actions, output: { ok: false } }]), false)
	assert.equal(
		summaryToolsCompleted([
			{ ...html, type: 'tool-update_shapes', input: { updates: [{ patch: { html: 'new' } }] } },
			actions,
		]),
		true,
	)
	assert.equal(
		summaryToolsCompleted([
			{ ...html, type: 'tool-update_shapes', input: { updates: [{ patch: { title: 'html' } }] } },
			actions,
		]),
		false,
	)
})

test('assistant tab keyboard protocol opens chat by default and reaches endpoints', () => {
	assert.equal(DEFAULT_ASSISTANT_TAB, 'chat')
	assert.equal(nextAssistantTab('chat', 'ArrowLeft', true), 'settings')
	assert.equal(nextAssistantTab('settings', 'ArrowRight', true), 'chat')
	assert.equal(nextAssistantTab('chat', 'ArrowRight', true), 'audio')
	assert.equal(nextAssistantTab('audio', 'ArrowRight', true), 'live')
	assert.equal(nextAssistantTab('live', 'ArrowRight', true), 'settings')
	assert.equal(nextAssistantTab('live', 'Home', true), 'chat')
	assert.equal(nextAssistantTab('chat', 'End', true), 'settings')
})

test('deployment tabs and selection never enter hidden Settings', () => {
	assert.deepEqual(assistantTabs(false), ['chat', 'audio', 'live'])
	assert.deepEqual(assistantTabs(true), ['chat', 'audio', 'live', 'settings'])
	assert.equal(resolveAssistantTab('settings', false), 'chat')
	assert.equal(resolveAssistantTab('settings', true), 'settings')
	assert.equal(nextAssistantTab('chat', 'End', false), 'live')
	assert.equal(nextAssistantTab('live', 'ArrowRight', false), 'chat')
	assert.equal(nextAssistantTab('chat', 'ArrowLeft', false), 'live')
	assert.equal(nextAssistantTab('live', 'Home', false), 'chat')
	assert.equal(nextAssistantTab('settings', 'ArrowRight', false), 'audio')
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

test('composer focus follows explicit opens, not initial mount or tab changes', () => {
	assert.equal(shouldFocusComposer(true, true, 'chat'), false)
	assert.equal(shouldFocusComposer(false, false, 'chat'), false)
	assert.equal(shouldFocusComposer(false, true, 'chat'), true)
	assert.equal(shouldFocusComposer(true, true, 'chat'), false)
	assert.equal(shouldFocusComposer(false, true, 'audio'), false)
})

test('Live microphone defaults to 900 ms silence cut and detects standalone fillers', () => {
	assert.equal((micVm as Record<string, unknown>).LIVE_MICROPHONE_SILENCE_MS, 900)
	const isLowSignal = (protocol as Record<string, unknown>).isLowSignalSegment as (
		text: string,
	) => boolean
	assert.equal(typeof isLowSignal, 'function')

	for (const filler of [
		'嗯。',
		'好的，收到。',
		'行，没问题。',
		'はい。',
		'ええ、そうですね。',
		'なるほど。',
		'Uh-huh.',
		'Okay, got it.',
		'All right, makes sense.',
	]) {
		assert.equal(isLowSignal(filler), true, `Expected filler: ${filler}`)
	}
	for (const substantive of [
		'Q3 DAU 涨到了 184 万。',
		'We should switch to pooled connections.',
		'案Aは1200円です。',
		'接下来看第二个议题。',
		'Now let us move to the next topic.',
	]) {
		assert.equal(isLowSignal(substantive), false, `Expected substantive: ${substantive}`)
	}
})

test('adaptive lecture batching scales up on backlog and flushes at session end', () => {
	const mkSeg = (len: number, count: number) =>
		Array.from({ length: count }, (_, idx) => `seg-${idx} ${'a'.repeat(Math.max(0, len - 8))}`)

	const takeAdaptive = takeLectureBatch as (
		queue: readonly string[],
		maxCount?: number,
		maxChars?: number,
		options?: { flushAll?: boolean },
	) => { batch: string[]; remaining: string[] }

	assert.equal(takeAdaptive(mkSeg(250, 3)).batch.length, 3)
	assert.equal(takeAdaptive(mkSeg(300, 6)).batch.length, 6)
	assert.equal(takeAdaptive(mkSeg(320, 9)).batch.length, 8)
	assert.equal(
		takeAdaptive(mkSeg(320, 9), undefined, undefined, { flushAll: true }).batch.length,
		8,
	)
	assert.equal(takeAdaptive(mkSeg(300, 6), 3, 900).batch.length, 3)
})

test('post-session auto summary recovers from transient lecture errors without looping summary errors', () => {
	const shouldAuto = (protocol as Record<string, unknown>).shouldAutoRequestSummary as (state: {
		sessionEnded: boolean
		error: boolean
		lastErrorSource: 'lecture' | 'summary' | 'chat' | null
		busy: boolean
		summaryDone: boolean
		summaryRequesting: boolean
		summaryAttempted: boolean
		messagesLength: number
		requestLock: boolean
		queueLength: number
	}) => boolean
	assert.equal(typeof shouldAuto, 'function')

	const base = {
		sessionEnded: true,
		error: true,
		lastErrorSource: 'lecture' as const,
		busy: false,
		summaryDone: false,
		summaryRequesting: false,
		summaryAttempted: false,
		messagesLength: 10,
		requestLock: false,
		queueLength: 0,
	}
	assert.equal(shouldAuto(base), true)
	assert.equal(shouldAuto({ ...base, lastErrorSource: 'summary' }), false)
	assert.equal(shouldAuto({ ...base, summaryAttempted: true }), false)
	assert.equal(shouldAuto({ ...base, queueLength: 2 }), false)
})
