import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	buildAiSettingsPayload,
	parseAiModels,
	parseAiSettings,
} from './frame/assistant/useAiSettingsViewModel.ts'
import {
	microphoneAiLabel,
	microphonePhaseLabel,
} from './frame/assistant/useMicrophoneViewModel.ts'
import { mossCompletedToolActivity } from './frame/assistant/useMossViewModel.ts'
import { en } from './i18n/index.ts'
import { zh } from './i18n/zh.ts'

test('AI settings payload preserves key, reasoning and clear semantics', () => {
	assert.deepEqual(
		buildAiSettingsPayload(' https://example.test/ ', ' gpt-model ', '', false, 'none', 'low'),
		{
			baseURL: 'https://example.test/',
			model: 'gpt-model',
			lectureReasoning: 'none',
			chatReasoning: 'low',
		},
	)
	assert.deepEqual(
		buildAiSettingsPayload('https://example.test', 'model', 'secret', false, 'minimal', 'medium'),
		{
			baseURL: 'https://example.test',
			model: 'model',
			lectureReasoning: 'minimal',
			chatReasoning: 'medium',
			apiKey: 'secret',
		},
	)
	assert.deepEqual(buildAiSettingsPayload('https://example.test', 'model', 'ignored', true), {
		baseURL: 'https://example.test',
		model: 'model',
		apiKey: '',
	})
})

test('AI settings validation requires auth mode and valid reasoning levels', () => {
	assert.deepEqual(
		parseAiSettings({
			baseURL: 'https://example.test/v1',
			model: 'model/test',
			hasApiKey: false,
			readOnly: true,
			authMode: 'managed-identity',
			lectureReasoning: 'none',
			chatReasoning: 'low',
		}),
		{
			baseURL: 'https://example.test/v1',
			model: 'model/test',
			hasApiKey: false,
			readOnly: true,
			authMode: 'managed-identity',
			lectureReasoning: 'none',
			chatReasoning: 'low',
		},
	)
	assert.throws(
		() => parseAiSettings({ baseURL: '', model: '', hasApiKey: false, readOnly: false }),
		/Invalid AI settings/,
	)
	assert.throws(
		() =>
			parseAiSettings({
				baseURL: '',
				model: '',
				hasApiKey: false,
				readOnly: false,
				authMode: 'api-key',
				lectureReasoning: 'invalid',
				chatReasoning: 'low',
			}),
		/Invalid AI settings/,
	)
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

test('microphone presentation preserves phase and AI status priority in both locales', () => {
	assert.equal(microphonePhaseLabel('stopping', en.assistant.live), 'Finishing transcript…')
	assert.equal(microphonePhaseLabel('done', en.assistant.live), 'Recording complete')
	assert.equal(microphonePhaseLabel('error', en.assistant.live), 'Microphone error')
	assert.equal(microphonePhaseLabel('listening', en.assistant.live), 'Listening…')
	assert.equal(microphonePhaseLabel('connecting', en.assistant.live), 'Connecting…')
	assert.equal(microphonePhaseLabel('idle', en.assistant.live), 'Ready')
	assert.equal(microphoneAiLabel(true, true, 3, en.assistant.live), 'AI update failed')
	assert.equal(microphoneAiLabel(false, true, 3, en.assistant.live), 'Drawing on canvas…')
	assert.equal(microphoneAiLabel(false, false, 2, en.assistant.live), '2 segments queued')
	assert.equal(microphoneAiLabel(false, false, 0, en.assistant.live), 'Mico is listening')

	assert.equal(microphonePhaseLabel('stopping', zh.assistant.live), '正在整理字幕…')
	assert.equal(microphonePhaseLabel('done', zh.assistant.live), '录音已完成')
	assert.equal(microphonePhaseLabel('error', zh.assistant.live), '麦克风出错')
	assert.equal(microphonePhaseLabel('listening', zh.assistant.live), '聆听中…')
	assert.equal(microphonePhaseLabel('connecting', zh.assistant.live), '连接中…')
	assert.equal(microphonePhaseLabel('idle', zh.assistant.live), '就绪')
	assert.equal(microphoneAiLabel(true, true, 3, zh.assistant.live), 'AI 更新失败')
	assert.equal(microphoneAiLabel(false, true, 3, zh.assistant.live), '正在绘制到画布…')
	assert.equal(microphoneAiLabel(false, false, 2, zh.assistant.live), '队列中 2 段')
	assert.equal(microphoneAiLabel(false, false, 0, zh.assistant.live), 'Mico 正在聆听')
})
