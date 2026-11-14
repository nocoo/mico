import type { ServerResponse } from 'node:http'
import { createAzure } from '@ai-sdk/azure'
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
import type { ChatSettings } from './aiConfig.ts'
import { buildInstructions } from './aiPrompt.ts'
import { createCanvasTools } from './aiTools.ts'
import type { ImageGenerationService } from './imageGeneration.ts'
import { createRedirectSafeFetch } from './managedIdentity.ts'
import { OperationError, type TenantStore } from './store.ts'

export function createMagpieModel(
	settings: ChatSettings,
	chatBearer?: () => Promise<string>,
): LanguageModel {
	if (settings.authMode === 'managed-identity') {
		if (!chatBearer) throw new Error('Managed identity token provider is required')
		return createAzure({
			baseURL: settings.baseURL,
			tokenProvider: chatBearer,
			fetch: createRedirectSafeFetch(),
		}).responses(settings.model)
	}
	const provider = createOpenAICompatible({
		name: 'magpie',
		baseURL: settings.baseURL,
		apiKey: settings.apiKey || undefined,
		fetch: createRedirectSafeFetch(),
	})
	return provider.chatModel(settings.model)
}

export async function fetchAiModels(
	settings: ChatSettings,
	timeoutMs = 5000,
	chatBearer?: () => Promise<string>,
): Promise<string[]> {
	const unavailable = () =>
		new OperationError(502, 'AI_MODELS_UNAVAILABLE', 'Could not fetch AI models')

	let modelsURL: string
	try {
		const url = new URL(settings.baseURL)
		url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`
		url.search = ''
		url.hash = ''
		modelsURL = url.toString()
	} catch {
		throw unavailable()
	}

	let response: Response
	try {
		const headers = new Headers({ Accept: 'application/json' })
		if (settings.authMode === 'managed-identity') {
			if (!chatBearer) throw unavailable()
			headers.set('Authorization', `Bearer ${await chatBearer()}`)
		} else if (settings.apiKey) {
			headers.set('Authorization', `Bearer ${settings.apiKey}`)
		}
		response = await fetch(modelsURL, {
			method: 'GET',
			headers,
			redirect: 'manual',
			signal: AbortSignal.timeout(timeoutMs),
		})
	} catch {
		throw unavailable()
	}

	if (!response.ok) throw unavailable()

	let payload: unknown
	try {
		payload = await response.json()
	} catch {
		throw unavailable()
	}

	if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
		throw unavailable()
	}
	const data = (payload as { data?: unknown }).data
	if (!Array.isArray(data)) throw unavailable()

	const models: string[] = []
	for (const item of data) {
		if (typeof item !== 'object' || item === null || !('id' in item)) throw unavailable()
		const id = (item as { id?: unknown }).id
		if (typeof id !== 'string' || id.trim().length === 0) throw unavailable()
		models.push(id)
	}
	return models
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
	store: TenantStore
	broadcast: (event: unknown) => void
	model: LanguageModel
	request: AiChatRequest
	origin?: string
	imageGeneration?: ImageGenerationService
	lectureReasoning: string
}

export async function streamAiChat({
	res,
	store,
	broadcast,
	model,
	request,
	origin,
	imageGeneration,
	lectureReasoning,
}: AiResponseOptions): Promise<void> {
	const canvasId = request.canvasId ?? (await store.getActiveCanvasId())
	const board = await store.getBoard(canvasId)
	const abort = new AbortController()
	res.on('close', () => abort.abort())
	const headers: Record<string, string> = { 'Cache-Control': 'private, no-store' }
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		headers['Access-Control-Allow-Origin'] = origin
		headers.Vary = 'Origin'
	}
	const result = streamText({
		model,
		instructions: buildInstructions(board, request.selection, request.mode),
		messages: await convertToModelMessages(request.messages),
		tools: await createCanvasTools({
			store,
			broadcast,
			selection: request.selection,
			canvasId,
			revision: board.revision,
			imageGeneration,
		}),
		stopWhen:
			request.mode === 'lecture'
				? [
						(options) =>
							options.steps.reduce((count, step) => count + step.toolCalls.length, 0) >= 8,
						isStepCount(16),
					]
				: isStepCount(40),
		maxRetries: 1,
		abortSignal: abort.signal,
		providerOptions:
			typeof model === 'object' && model.provider === 'azure.responses'
				? {
						azure: {
							reasoningEffort: request.mode === 'lecture' ? lectureReasoning : 'low',
							store: false,
							strictJsonSchema: false,
						},
					}
				: { magpie: { reasoningEffort: request.mode === 'lecture' ? lectureReasoning : 'low' } },
		prepareStep:
			request.mode === 'lecture'
				? undefined
				: ({ stepNumber }) => (stepNumber === 0 ? { toolChoice: 'required' } : undefined),
		onError: () => {
			console.error('AI request failed')
			return 'The assistant could not reach the configured AI provider. Check the daemon log and AI settings.'
		},
	})
	await result.pipeUIMessageStreamToResponse(res, { headers })
}
