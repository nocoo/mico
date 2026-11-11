import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAiSettingsPayload, parseAiModels } from './frame/assistant/useAiSettingsViewModel.ts'
import {
	microphoneAiLabel,
	microphonePhaseLabel,
} from './frame/assistant/useMicrophoneViewModel.ts'
import { mossCompletedToolActivity } from './frame/assistant/useMossViewModel.ts'

test('AI settings payload preserves key and clear semantics', () => {
	assert.deepEqual(buildAiSettingsPayload(' https://example.test/ ', ' gpt-model ', '', false), {
		baseURL: 'https://example.test/',
		model: 'gpt-model',
	})
	assert.deepEqual(buildAiSettingsPayload('https://example.test', 'model', 'secret', false), {
		baseURL: 'https://example.test',
		model: 'model',
		apiKey: 'secret',
	})
	assert.deepEqual(buildAiSettingsPayload('https://example.test', 'model', 'ignored', true), {
		baseURL: 'https://example.test',
		model: 'model',
		apiKey: '',
	})
})

test('AI model list validation rejects invalid payloads and removes duplicates', () => {
	assert.deepEqual(parseAiModels({ models: ['b', 'a', 'b'] }), ['b', 'a'])
	assert.throws(() => parseAiModels({ models: ['valid', 1] }), /Invalid model list/)
	assert.throws(() => parseAiModels({}), /Invalid model list/)
})

test('MOSS tool completion preserves specialized activity messages', () => {
	assert.equal(mossCompletedToolActivity('generate_image', 'done'), 'Image generation started')
	assert.equal(
		mossCompletedToolActivity('image_generation_status', 'done'),
		'Image generation checked',
	)
	assert.equal(mossCompletedToolActivity('draw_shape', 'done'), 'Canvas updated')
	assert.equal(mossCompletedToolActivity('draw_shape', 'error'), 'Tool failed: draw shape')
})

test('microphone presentation preserves phase and AI status priority', () => {
	assert.equal(microphonePhaseLabel('stopping'), 'Finishing transcript…')
	assert.equal(microphonePhaseLabel('done'), 'Recording complete')
	assert.equal(microphonePhaseLabel('error'), 'Microphone error')
	assert.equal(microphoneAiLabel(true, true, 3), 'Mico needs attention')
	assert.equal(microphoneAiLabel(false, true, 3), 'Mico is drawing…')
	assert.equal(microphoneAiLabel(false, false, 2), '2 segments queued')
	assert.equal(microphoneAiLabel(false, false, 0), 'Mico is listening')
})
