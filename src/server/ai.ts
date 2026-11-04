import type { ServerResponse } from 'node:http'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
	convertToModelMessages,
	isStepCount,
	isToolUIPart,
	type LanguageModel,
	safeValidateUIMessages,
	streamText,
	type UIMessage,
} from 'ai'
import { ALLOWED_ORIGINS } from '../shared/config.ts'
import { buildInstructions } from './aiPrompt.ts'
import { createCanvasTools } from './aiTools.ts'
import { type BoardStore, OperationError } from './store.ts'

export const MAGPIE_DEFAULT_BASE_URL = 'http://127.0.0.1:3425/v1'
export const MAGPIE_DEFAULT_MODEL = 'auto/gpt-6-luna'
export const MAGPIE_DEFAULT_API_KEY = 'magpie'

export interface MagpieSettings {
	baseURL: string
	apiKey: string
	model: string
}

export function magpieSettings(env: NodeJS.ProcessEnv = process.env): MagpieSettings {
	return {
		baseURL: (env.MAGPIE_BASE_URL?.trim() || MAGPIE_DEFAULT_BASE_URL).replace(/\/+$/, ''),
		model: env.MAGPIE_MODEL?.trim() || MAGPIE_DEFAULT_MODEL,
		apiKey: env.MAGPIE_API_KEY === undefined ? MAGPIE_DEFAULT_API_KEY : env.MAGPIE_API_KEY,
	}
}

export function createMagpieModel(settings = magpieSettings()): LanguageModel {
	const provider = createOpenAICompatible({
		name: 'magpie',
		baseURL: settings.baseURL,
		...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
	})
	return provider.chatModel(settings.model)
}

const COMPLETE_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied'])

export function sanitizeInterruptedMessages(messages: UIMessage[]): UIMessage[] {
	return messages.flatMap((message) => {
		if (message.role !== 'assistant') return [message]
		const parts = message.parts.filter(
			(part) => !isToolUIPart(part) || COMPLETE_TOOL_STATES.has(part.state),
		)
		if (parts.length === 0) return []
		return [{ ...message, parts }]
	})
}

export type AiChatMode = 'chat' | 'lecture'

export interface AiChatRequest {
	messages: UIMessage[]
	selection: string[]
	mode: AiChatMode
	canvasId?: string
}

export async function parseAiChatRequest(body: unknown): Promise<AiChatRequest> {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new OperationError(400, 'INVALID_REQUEST', 'request must be an object')
	}
	const record = body as Record<string, unknown>
	if (!Array.isArray(record.messages) || record.messages.length === 0) {
		throw new OperationError(400, 'INVALID_REQUEST', 'messages must be a non-empty array')
	}
	if (record.messages.length > 200) {
		throw new OperationError(400, 'INVALID_REQUEST', 'messages must contain at most 200 entries')
	}
	const selection = record.selection === undefined ? [] : record.selection
	if (!Array.isArray(selection) || selection.some((id) => typeof id !== 'string')) {
		throw new OperationError(400, 'INVALID_REQUEST', 'selection must be an array of ids')
	}
	const mode = record.mode === undefined ? 'chat' : record.mode
	if (mode !== 'chat' && mode !== 'lecture') {
		throw new OperationError(400, 'INVALID_REQUEST', 'mode must be chat or lecture')
	}
	const rawCanvasId = record.canvasId
	const canvasId = rawCanvasId === undefined || rawCanvasId === '' ? undefined : rawCanvasId
	if (canvasId !== undefined && (typeof canvasId !== 'string' || canvasId.length > 80)) {
		throw new OperationError(400, 'INVALID_REQUEST', 'canvasId must be a canvas id')
	}
	const validated = await safeValidateUIMessages({ messages: record.messages })
	if (!validated.success) {
		throw new OperationError(400, 'INVALID_REQUEST', 'messages are not valid UI messages')
	}
	return {
		messages: sanitizeInterruptedMessages(validated.data),
		mode,
		canvasId,
		selection: selection
			.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64)
			.slice(0, 200),
	}
}

interface AiResponseOptions {
	res: ServerResponse
	store: BoardStore
	broadcast: (event: unknown) => void
	model: LanguageModel
	request: AiChatRequest
	origin?: string
}

export async function streamAiChat({
	res,
	store,
	broadcast,
	model,
	request,
	origin,
}: AiResponseOptions): Promise<void> {
	const canvasId = request.canvasId ?? store.getActiveCanvasId()
	const board = store.getBoard(canvasId)
	const abort = new AbortController()
	res.on('close', () => abort.abort())
	const headers: Record<string, string> = {}
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		headers['Access-Control-Allow-Origin'] = origin
		headers.Vary = 'Origin'
	}
	const result = streamText({
		model,
		instructions: buildInstructions(board, request.selection, request.mode),
		messages: await convertToModelMessages(request.messages),
		tools: createCanvasTools({
			store,
			broadcast,
			selection: request.selection,
			canvasId,
			revision: board.revision,
		}),
		stopWhen:
			request.mode === 'lecture'
				? [
						(options) =>
							options.steps.reduce((count, step) => count + step.toolCalls.length, 0) >= 3,
						isStepCount(12),
					]
				: isStepCount(40),
		maxRetries: 1,
		abortSignal: abort.signal,
		providerOptions:
			request.mode === 'lecture'
				? { magpie: { reasoningEffort: process.env.MAGPIE_LECTURE_REASONING || 'none' } }
				: undefined,
		prepareStep:
			request.mode === 'lecture'
				? undefined
				: ({ stepNumber }) => (stepNumber === 0 ? { toolChoice: 'required' } : undefined),
		onError: ({ error }) => {
			console.error('AI request failed:', error)
			return 'The assistant could not reach the Magpie model gateway. Check the daemon log and MAGPIE_BASE_URL.'
		},
	})
	await result.pipeUIMessageStreamToResponse(res, { headers })
}
