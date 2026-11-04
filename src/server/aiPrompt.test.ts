import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POST_SESSION_SUMMARY_PROMPT, SUMMARY_CARD_INSTRUCTIONS } from '../shared/summaryPrompt.ts'
import { AI_LECTURE_PROMPT, AI_SYSTEM_PROMPT } from './aiPrompt.ts'

test('live drawing instructions allow growth and preserve topic and bed identity', () => {
	assert.match(AI_SYSTEM_PROMPT, /x=80, y=144/)
	assert.match(AI_SYSTEM_PROMPT, /group by ward then bed/i)
	assert.match(AI_SYSTEM_PROMPT, /revise it with update_shapes/i)
	assert.match(AI_SYSTEM_PROMPT, /memberIds/)
	assert.doesNotMatch(AI_SYSTEM_PROMPT, /LAYOUT_LIMIT|exactly two columns|y=1600/)
	assert.match(AI_LECTURE_PROMPT, /clearly enters a final summary/i)
	assert.doesNotMatch(AI_LECTURE_PROMPT, /Do not create a session summary card/)
})

test('live and post-session summaries share the same instructions', () => {
	assert.ok(AI_LECTURE_PROMPT.includes(SUMMARY_CARD_INSTRUCTIONS))
	assert.ok(POST_SESSION_SUMMARY_PROMPT.includes(SUMMARY_CARD_INSTRUCTIONS))
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /data-lucide/)
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /update that same card rather than creating a duplicate/)
})
