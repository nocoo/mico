import assert from 'node:assert/strict'
import { test } from 'node:test'
import { convertToModelMessages, type UIMessage } from 'ai'
import { compactUiMessages } from './conversationCompact.ts'

function makeConversation(turnCount: number): UIMessage[] {
	const messages: UIMessage[] = []
	for (let turn = 1; turn <= turnCount; turn++) {
		messages.push({
			id: `u-${turn}`,
			role: 'user',
			parts: [{ type: 'text', text: `Segment ${turn}: metric milestone update and action item.` }],
		})
		if (turn === turnCount) break
		messages.push({
			id: `a-${turn}`,
			role: 'assistant',
			parts: [
				{
					type: 'tool-get_board',
					toolCallId: `board-${turn}`,
					state: 'output-available',
					input: {},
					output: {
						ok: true,
						revision: turn,
						count: 20,
						shapes: Array.from({ length: 12 }, (_, idx) => ({
							id: `s-${idx}`,
							type: 'note',
							text: `Long shape detail ${idx}`,
						})),
					},
				},
				{
					type: 'tool-add_html_cards',
					toolCallId: `card-${turn}`,
					state: 'output-available',
					input: {
						cards: [
							{
								id: `topic-card-${turn}`,
								x: 1620,
								y: 260,
								w: 960,
								h: 640,
								title: `Topic ${turn}`,
								html: `<main class="mico-report">${'Detailed HTML '.repeat(40)}</main>`,
							},
						],
					},
					output: {
						ok: true,
						revision: turn,
						created: [{ id: `topic-card-${turn}`, type: 'html' }],
					},
				},
				{ type: 'text', text: `Updated board at turn ${turn}.` },
			],
		})
	}
	return messages
}

test('short conversations without bulky history pass through at exact length', () => {
	const small: UIMessage[] = [
		{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Draw wave interference' }] },
		{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Drew two sources.' }] },
	]
	const result = compactUiMessages(small)
	assert.equal(result.length, 2)
	assert.deepEqual(result, small)
})

test('chunk-aligned compaction keeps archived prefix and shared hot turns byte-identical across nearby turns', () => {
	const turn119 = compactUiMessages(makeConversation(119))
	const turn120 = compactUiMessages(makeConversation(120))
	assert.equal(turn119[0]?.id, 'compact-archive-228')
	assert.equal(turn120[0]?.id, 'compact-archive-228')
	assert.equal(JSON.stringify(turn119[0]), JSON.stringify(turn120[0]))
	assert.equal(JSON.stringify(turn119[1]), JSON.stringify(turn120[1]))

	const sharedCount = turn119.length - 1
	assert.equal(
		JSON.stringify(turn119.slice(0, sharedCount)),
		JSON.stringify(turn120.slice(0, sharedCount)),
	)
})

test('compaction slims bulky historical tool payloads while keeping model messages valid', async () => {
	const compacted = compactUiMessages(makeConversation(6))
	const earlyAssistant = compacted[1]
	assert.equal(earlyAssistant?.role, 'assistant')
	const boardPart = earlyAssistant.parts.find((part) => part.type === 'tool-get_board') as
		| { output?: Record<string, unknown> }
		| undefined
	assert.equal(boardPart?.output?.compacted, true)
	assert.equal('shapes' in (boardPart?.output ?? {}), false)

	const cardPart = earlyAssistant.parts.find((part) => part.type === 'tool-add_html_cards') as
		| { input?: { cards?: Array<{ html?: string }> } }
		| undefined
	const html = cardPart?.input?.cards?.[0]?.html ?? ''
	assert.ok(html.length > 0 && html.length < 120)

	const modelMessages = await convertToModelMessages(compacted)
	assert.ok(modelMessages.length >= 6)
})
