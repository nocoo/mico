import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { CANDY_COLORS } from '../shared/palette.ts'

const usage = {
	inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 40, text: 40, reasoning: undefined },
}

interface MockToolCall {
	id: string
	name: string
	input: Record<string, unknown>
}

function toolCallChunk(call: MockToolCall): LanguageModelV4StreamPart[] {
	const input = JSON.stringify(call.input)
	return [
		{ type: 'tool-input-start', id: call.id, toolName: call.name },
		{ type: 'tool-input-delta', id: call.id, delta: input },
		{ type: 'tool-input-end', id: call.id },
		{ type: 'tool-call', toolCallId: call.id, toolName: call.name, input },
	]
}

function stream(chunks: LanguageModelV4StreamPart[]) {
	return { stream: simulateReadableStream({ chunks }) }
}

function textChunks(text: string): LanguageModelV4StreamPart[] {
	return [
		{ type: 'text-start', id: `mock-text-${text.length}` },
		{ type: 'text-delta', id: `mock-text-${text.length}`, delta: text },
		{ type: 'text-end', id: `mock-text-${text.length}` },
	]
}

function finish(reason: 'stop' | 'tool-calls'): LanguageModelV4StreamPart {
	return { type: 'finish', finishReason: { unified: reason, raw: undefined }, usage }
}

function promptTurns(prompt: Parameters<MockLanguageModelV4['doStream']>[0]['prompt']) {
	const users = prompt.filter((message) => message.role === 'user')
	const lastUser = prompt.findLastIndex((message) => message.role === 'user')
	const toolResults = prompt.slice(lastUser + 1).filter((message) => message.role === 'tool').length
	return { turn: users.length, toolResults }
}

export function createMockAiModel(): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		provider: 'magpie-mock',
		modelId: 'auto/gpt-6-luna',
		doStream: async (options) => {
			const { turn, toolResults } = promptTurns(options.prompt)
			const prefix = `mock-${turn}`
			if (toolResults === 0) {
				return stream([
					{ type: 'stream-start', warnings: [] },
					...textChunks('Starting with a title and the key labels.'),
					...toolCallChunk({
						id: `${prefix}-call-title`,
						name: 'add_texts',
						input: {
							texts: [
								{
									id: `${prefix}-title`,
									x: 80,
									y: 64,
									text: 'Projectile motion',
									fontSize: 48,
									fontWeight: 700,
									color: CANDY_COLORS.ink,
								},
								{
									id: `${prefix}-subtitle`,
									x: 80,
									y: 132,
									text: 'Horizontal velocity stays constant; gravity changes vertical velocity.',
									w: 720,
									h: 56,
									fontSize: 20,
									color: CANDY_COLORS.ink,
								},
							],
						},
					}),
					finish('tool-calls'),
				])
			}
			if (toolResults === 1) {
				return stream([
					{ type: 'stream-start', warnings: [] },
					...textChunks('Now the launch point and the flying ball.'),
					...toolCallChunk({
						id: `${prefix}-call-boxes`,
						name: 'add_boxes',
						input: {
							boxes: [
								{
									id: `${prefix}-launch`,
									x: 120,
									y: 260,
									w: 180,
									h: 80,
									text: 'Launch',
									color: CANDY_COLORS.blue,
								},
								{
									id: `${prefix}-ball`,
									kind: 'ellipse',
									x: 560,
									y: 160,
									w: 120,
									h: 120,
									text: 'Ball',
									color: CANDY_COLORS.pink,
								},
							],
						},
					}),
					finish('tool-calls'),
				])
			}
			if (toolResults === 2) {
				return stream([
					{ type: 'stream-start', warnings: [] },
					...textChunks('Adding axes and the parabolic trajectory.'),
					...toolCallChunk({
						id: `${prefix}-call-axes`,
						name: 'add_lines',
						input: {
							lines: [
								{
									id: `${prefix}-axis-x`,
									from: { x: 80, y: 380 },
									to: { x: 760, y: 380 },
									color: CANDY_COLORS.ink,
								},
								{
									id: `${prefix}-axis-y`,
									from: { x: 80, y: 380 },
									to: { x: 80, y: 100 },
									color: CANDY_COLORS.ink,
								},
							],
						},
					}),
					...toolCallChunk({
						id: `${prefix}-call-stroke`,
						name: 'add_strokes',
						input: {
							strokes: [
								{
									id: `${prefix}-path`,
									points: [
										{ x: 140, y: 280 },
										{ x: 280, y: 180 },
										{ x: 420, y: 150 },
										{ x: 560, y: 210 },
										{ x: 660, y: 340 },
									],
									color: CANDY_COLORS.green,
									strokeWidth: 4,
								},
							],
						},
					}),
					finish('tool-calls'),
				])
			}
			if (toolResults === 3) {
				return stream([
					{ type: 'stream-start', warnings: [] },
					...toolCallChunk({
						id: `${prefix}-call-connector`,
						name: 'add_connectors',
						input: {
							connectors: [
								{
									id: `${prefix}-flow`,
									from: `${prefix}-launch`,
									to: `${prefix}-ball`,
									color: CANDY_COLORS.blue,
								},
							],
						},
					}),
					finish('tool-calls'),
				])
			}
			if (toolResults === 4) {
				return stream([
					{ type: 'stream-start', warnings: [] },
					...toolCallChunk({ id: `${prefix}-call-board`, name: 'get_board', input: {} }),
					finish('tool-calls'),
				])
			}
			return stream([
				{ type: 'stream-start', warnings: [] },
				...textChunks(
					'The diagram is ready: a title, launch point, ball, axes, trajectory and the flow between the two objects.',
				),
				finish('stop'),
			])
		},
	})
}
