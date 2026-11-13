import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	HTML_CARD_CSS,
	HTML_CARD_DESIGN_INSTRUCTIONS,
	HTML_CARD_FRAGMENTS,
} from '../shared/htmlCardDesign.ts'
import { POST_SESSION_SUMMARY_PROMPT, SUMMARY_CARD_INSTRUCTIONS } from '../shared/summaryPrompt.ts'
import { AI_LECTURE_PROMPT, AI_SYSTEM_PROMPT } from './aiPrompt.ts'

test('live drawing instructions organize three semantic groups left to right', () => {
	assert.match(AI_SYSTEM_PROMPT, /x=80, y=144/)
	assert.match(AI_SYSTEM_PROMPT, /side by side from left to right/)
	assert.match(AI_SYSTEM_PROMPT, /never label the groups A, B, C/)
	assert.match(AI_SYSTEM_PROMPT, /subject-specific headings/)
	assert.match(AI_SYSTEM_PROMPT, /Revise it with update_shapes/i)
	assert.match(AI_SYSTEM_PROMPT, /Consolidate closely related facts of the same category/)
	assert.match(AI_SYSTEM_PROMPT, /Set label to a concise category/)
	assert.match(AI_SYSTEM_PROMPT, /purple region heading/)
	assert.match(AI_SYSTEM_PROMPT, /preserving values, units, time periods and qualifiers/)
	assert.match(AI_SYSTEM_PROMPT, /Prioritize a few meaningful relationships/)
	assert.match(AI_SYSTEM_PROMPT, /Do not invent a link just to connect a node/)
	assert.match(AI_SYSTEM_PROMPT, /Never use the saturated outline colors as note fills/)
	assert.match(AI_SYSTEM_PROMPT, /memberIds/)
	assert.match(
		AI_SYSTEM_PROMPT,
		/title bar occupies 40px above the top edge, outside the frame bounds/,
	)
	assert.match(AI_SYSTEM_PROMPT, /reserve at least 48px of clear space above every frame/)
	assert.match(AI_SYSTEM_PROMPT, /side-by-side frames, align their top edges/)
	assert.match(AI_SYSTEM_PROMPT, /topmost member of each group at the same y/)
	assert.doesNotMatch(AI_SYSTEM_PROMPT, /LAYOUT_LIMIT|exactly two columns|y=1600|Place C below/)
	assert.match(AI_LECTURE_PROMPT, /a standalone fact can remain only in the evidence/)
	assert.match(AI_LECTURE_PROMPT, /clearly enters a final summary/i)
	assert.match(AI_LECTURE_PROMPT, /rightmost HTML summary/)
})

test('HTML cards share a copyable design system', () => {
	assert.ok(AI_SYSTEM_PROMPT.includes(HTML_CARD_DESIGN_INSTRUCTIONS))
	assert.ok(HTML_CARD_DESIGN_INSTRUCTIONS.includes(`<style>${HTML_CARD_CSS}</style>`))
	assert.ok(HTML_CARD_DESIGN_INSTRUCTIONS.includes(HTML_CARD_FRAGMENTS))
	for (const part of ['mico-panel', 'mico-hero', 'mico-list', 'mico-tile', 'mico-table']) {
		assert.ok(HTML_CARD_CSS.includes(`.${part}`))
		assert.ok(HTML_CARD_FRAGMENTS.includes(part))
	}
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /reusable HTML card CSS/)
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
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /preserve both the question and its supported answer/)
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /Hiding overflow does not make content fit/)
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /beyond the right edge/)
	assert.match(SUMMARY_CARD_INSTRUCTIONS, /rather than adding a large empty gap/)
	assert.doesNotMatch(SUMMARY_CARD_INSTRUCTIONS, /below the lowest/)
})
