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
	assert.match(
		AI_SYSTEM_PROMPT,
		/title bar occupies 40px above the top edge, outside the frame bounds/,
	)
	assert.match(AI_SYSTEM_PROMPT, /reserve at least 48px of clear space above every frame/)
	assert.match(AI_SYSTEM_PROMPT, /side-by-side frames, align their top edges/)
	assert.match(AI_SYSTEM_PROMPT, /topmost member of each group at the same y/)
	assert.doesNotMatch(AI_SYSTEM_PROMPT, /LAYOUT_LIMIT|exactly two columns|y=1600|Place C below/)
	assert.match(AI_LECTURE_PROMPT, /clearly enters a final summary/i)
	assert.match(AI_LECTURE_PROMPT, /rightmost HTML summary/)
})

test('image generation is optional, asynchronous and respects board layout', () => {
	assert.match(AI_SYSTEM_PROMPT, /Generate an image only when/)
	assert.match(AI_SYSTEM_PROMPT, /GPT Image 2\.5 Flare/)
	assert.match(AI_SYSTEM_PROMPT, /never cover existing objects/i)
	assert.match(AI_SYSTEM_PROMPT, /restrained, subtle, low-contrast/)
	assert.match(AI_SYSTEM_PROMPT, /at most five images/)
	assert.match(
		AI_SYSTEM_PROMPT,
		/do not start a second image until the previous generation has finished/,
	)
	assert.match(AI_SYSTEM_PROMPT, /never claim an image exists before completion/)
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
