import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mossAssistantActivity, nextMossToolActivity } from './frame/assistant/useMossViewModel.ts'

test('MOSS tool failures take priority while other calls remain pending', () => {
	const first = nextMossToolActivity(0, 'draw_shape', 'started')
	const overlapping = nextMossToolActivity(first.pending, 'generate_image', 'started')
	assert.deepEqual(overlapping, { pending: 2, activity: 'Drawing: generate image' })

	const failed = nextMossToolActivity(overlapping.pending, 'draw_shape', 'error')
	assert.deepEqual(failed, { pending: 1, activity: 'Tool failed: draw shape' })

	assert.deepEqual(nextMossToolActivity(failed.pending, 'generate_image', 'done'), {
		pending: 0,
		activity: 'Image generation started',
	})
	assert.deepEqual(nextMossToolActivity(2, 'draw_shape', 'done'), {
		pending: 1,
		activity: 'Drawing…',
	})
})

test('MOSS status reports its active phase, activity and error', () => {
	assert.equal(
		mossAssistantActivity({ phase: 'idle', activity: 'Ready to draw', detail: '' }),
		null,
	)
	assert.deepEqual(
		mossAssistantActivity({ phase: 'connecting', activity: 'Ready to draw', detail: '' }),
		{ state: 'work', text: 'MOSS Live is connecting…' },
	)
	assert.deepEqual(
		mossAssistantActivity({ phase: 'listening', activity: 'Ready to draw', detail: '' }),
		{ state: 'work', text: 'MOSS Live is listening…' },
	)
	assert.deepEqual(
		mossAssistantActivity({ phase: 'listening', activity: 'Tool failed: draw shape', detail: '' }),
		{ state: 'attention', text: 'Tool failed: draw shape' },
	)
	assert.deepEqual(
		mossAssistantActivity({
			phase: 'listening',
			activity: 'Ready to draw',
			detail: 'This response failed; retry when ready.',
		}),
		{ state: 'attention', text: 'This response failed; retry when ready.' },
	)
	assert.deepEqual(
		mossAssistantActivity({
			phase: 'error',
			activity: 'Ready to draw',
			detail: 'Connection closed',
		}),
		{ state: 'attention', text: 'Connection closed' },
	)
})
