import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	maiEmptyAudioBufferError,
	maiErrorCode,
	maiErrorMessage,
	maiEventItemId,
	maiEventRequestId,
} from './maiClient.ts'

test('MAI nested provider error exposes the exact message and code', () => {
	const event = {
		type: 'invalid_request_error',
		code: 'input_audio_buffer_commit_empty',
		message: 'Input audio buffer is empty.',
	}
	assert.equal(maiErrorCode(event), 'input_audio_buffer_commit_empty')
	assert.equal(maiErrorMessage(event), 'Input audio buffer is empty.')
	assert.equal(maiEmptyAudioBufferError(event), true)
})

test('MAI nested error shape remains distinguishable from the generic fallback', () => {
	const event = {
		error: {
			code: 'server_error',
			message: 'The transcription provider rejected the audio.',
		},
	}
	assert.equal(maiErrorCode(event), 'server_error')
	assert.equal(maiErrorMessage(event), 'The transcription provider rejected the audio.')
	assert.equal(maiEmptyAudioBufferError(event), false)
})

test('MAI item_id identifies acknowledged transcription items', () => {
	assert.equal(
		maiEventItemId({
			type: 'input_audio_buffer.committed',
			event_id: 'event_server_ack',
			item_id: 'item_first',
		}),
		'item_first',
	)
	assert.equal(maiEventItemId({ event_id: 'event_server_only' }), null)
})

test('MAI request event_id is preserved for correlated terminal errors', () => {
	assert.equal(
		maiEventRequestId({
			event_id: 'commit-1-2',
			error: { code: 'input_audio_buffer_commit_empty' },
		}),
		'commit-1-2',
	)
	assert.equal(
		maiEventRequestId({
			error: { event_id: 'commit-1-1', code: 'input_audio_buffer_commit_empty' },
		}),
		'commit-1-1',
	)
	assert.equal(maiEventRequestId({ error: { code: 'input_audio_buffer_commit_empty' } }), null)
})

test('MAI code-only and unknown errors never hide provider failure', () => {
	assert.equal(
		maiErrorMessage({ code: 'model_overloaded' }),
		'Transcription provider error: model_overloaded',
	)
	assert.equal(maiErrorMessage({}), 'Transcription provider failed.')
	assert.equal(maiEmptyAudioBufferError({ message: 'Input audio buffer is empty.' }), true)
})
