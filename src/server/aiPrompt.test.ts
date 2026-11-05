import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POST_SESSION_SUMMARY_PROMPT, SUMMARY_CARD_INSTRUCTIONS } from '../shared/summaryPrompt.ts'
import { AI_LECTURE_PROMPT, AI_SYSTEM_PROMPT } from './aiPrompt.ts'

test('live drawing instructions organize three semantic groups left to right', () => {
	assert.match(AI_SYSTEM_PROMPT, /x=80, y=144/)
	assert.match(AI_SYSTEM_PROMPT, /side by side from left to right/)
	assert.match(AI_SYSTEM_PROMPT, /never label the groups A, B, C/)
	assert.match(AI_SYSTEM_PROMPT, /subject-specific headings/)
	assert.match(AI_SYSTEM_PROMPT, /Revise it with update_shapes/i)
	assert.match(AI_SYSTEM_PROMPT, /memberIds/)
	assert.doesNotMatch(AI_SYSTEM_PROMPT, /LAYOUT_LIMIT|exactly two columns|y=1600|Place C below/)
	assert.match(AI_LECTURE_PROMPT, /clearly enters a final summary/i)
	assert.match(AI_LECTURE_PROMPT, /rightmost HTML summary/)
})

test('live and post-session summaries share the same instructions', () => {
	assert.ok(AI_LECTURE_PROMPT.includes(SUMMARY_CARD_INSTRUCTIONS))
	assert.ok(POST_SESSION_SUMMARY_PROMPT.includes(SUMMARY_CARD_INSTRUCTIONS))
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /data-lucide/)
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /update that same card in place/)
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /Bootstrap 5 CSS and JavaScript/)
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /beyond the right edge/)
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /rather than adding a large empty gap/)
	assert.doesNotMatch(SUMMARY_CARD_INSTRUCTIONS, /below the lowest/)
})
