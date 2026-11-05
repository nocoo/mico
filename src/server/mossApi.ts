import { z } from 'zod'
import type { Board } from '../shared/types.ts'
import { buildInstructions } from './aiPrompt.ts'
import { createCanvasTools } from './aiTools.ts'
import type { BoardStore } from './store.ts'
import { OperationError } from './store.ts'

export interface MossStore {
	getActiveCanvasId(): string
	getBoard(canvasId?: string): Board
	applyRequest(request: unknown): unknown
}

export const mossSessionSchema = z
	.object({
		canvasId: z.string().min(1).max(80).optional(),
		selection: z.array(z.string().min(1).max(64)).max(200).optional(),
	})
	.strict()

export const mossToolSchema = z
	.object({
		canvasId: z.string().min(1).max(80),
		selection: z.array(z.string().min(1).max(64)).max(200),
		revision: z.number().int().nonnegative(),
		name: z.string().min(1).max(64),
		input: z.unknown(),
	})
	.strict()

export interface MossToolDefinition {
	type: 'function'
	name: string
	description: string
	parameters: unknown
}

export interface MossSessionResponse {
	canvasId: string
	revision: number
	instructions: string
	tools: MossToolDefinition[]
}

function invalidRequest(message: string): never {
	throw new OperationError(400, 'INVALID_REQUEST', message)
}

function parseSchema<T>(schema: z.ZodType<T>, body: unknown, label: string): T {
	const parsed = schema.safeParse(body)
	if (parsed.success) return parsed.data
	const issue = parsed.error.issues[0]
	invalidRequest(
		issue ? `${label}: ${issue.path.join('.') || 'body'} ${issue.message}` : `${label} is invalid`,
	)
}

export function serializeCanvasTools(
	store: MossStore,
	broadcast: (event: unknown) => void,
	canvasId: string,
	selection: string[],
	revision: number,
): MossToolDefinition[] {
	const tools = createCanvasTools({
		store: store as unknown as BoardStore,
		broadcast,
		selection,
		canvasId,
		revision,
	})
	return Object.entries(tools).map(([name, tool]) => {
		const record = tool as unknown as { description?: string; inputSchema: z.ZodType }
		const parameters = z.toJSONSchema(record.inputSchema, {
			target: 'draft-7',
			io: 'input',
			unrepresentable: 'throw',
		})
		const { $schema: _schema, ...parametersWithoutMeta } = parameters as Record<string, unknown>
		return {
			type: 'function' as const,
			name,
			description: record.description ?? name,
			parameters: parametersWithoutMeta,
		}
	})
}

export function MOSS_LIVE_INSTRUCTIONS(): string {
	return `# MOSS Live realtime voice and tools

- This is a full-duplex voice session: you may speak while a tool call runs, and you may continue with a short spoken update before another tool call.
- User speech and interruptions override your current turn; listen, stop repeating the old plan, acknowledge the interruption, and respond to the user's latest request.
- Call the matching canvas tool for every board mutation. Tool inputs are validated by the server; on a tool error, explain or retry only with corrected inputs.
- Never say a canvas change succeeded until the tool result is actually returned and reports success. Report real ids and the result revision; on failure, report the error rather than inventing success.
- Do not apply lecture-mode WAIT rules to general MOSS speech. Speak naturally for normal conversation, clarification, and progress updates; WAIT is not a required response for ordinary full-duplex voice turns.`
}

export async function createMossSession(
	store: MossStore,
	broadcast: (event: unknown) => void,
	body: unknown,
): Promise<MossSessionResponse> {
	const request = parseSchema(mossSessionSchema, body, 'MOSS session request')
	const canvasId = request.canvasId ?? store.getActiveCanvasId()
	const board = store.getBoard(canvasId)
	const selection = request.selection ?? []
	return {
		canvasId,
		revision: board.revision,
		instructions: `${buildInstructions(board, selection)}\n\n${MOSS_LIVE_INSTRUCTIONS()}`,
		tools: serializeCanvasTools(store, broadcast, canvasId, selection, board.revision),
	}
}

export async function executeMossTool(
	store: MossStore,
	broadcast: (event: unknown) => void,
	body: unknown,
): Promise<{ result: unknown }> {
	const request = parseSchema(mossToolSchema, body, 'MOSS tool request')
	const board = store.getBoard(request.canvasId)

	const tools = createCanvasTools({
		store: store as unknown as BoardStore,
		broadcast,
		selection: request.selection,
		canvasId: request.canvasId,
		revision: request.revision,
	})
	const tool = (
		tools as unknown as Record<
			string,
			{
				description?: string
				inputSchema: z.ZodType
				execute?: (input: unknown, options: unknown) => unknown
			}
		>
	)[request.name]
	if (!tool) {
		throw new OperationError(404, 'UNKNOWN_TOOL', `Unknown MOSS tool: ${request.name}`)
	}
	if (board.revision !== request.revision && request.name !== 'get_board') {
		throw new OperationError(
			409,
			'REVISION_CONFLICT',
			`Canvas revision changed: request ${request.revision}, current ${board.revision}. Call get_board first, read the returned revision, then retry this mutation.`,
		)
	}

	const parsed = tool.inputSchema.safeParse(request.input)
	if (!parsed.success) {
		const issue = parsed.error.issues[0]
		throw new OperationError(
			400,
			'INVALID_TOOL_INPUT',
			issue
				? `Invalid input for ${request.name}: ${issue.path.join('.') || 'body'} ${issue.message}`
				: `Invalid input for ${request.name}`,
		)
	}
	if (!tool.execute) {
		throw new OperationError(
			500,
			'TOOL_NOT_EXECUTABLE',
			`MOSS tool is not executable: ${request.name}`,
		)
	}

	const result = await tool.execute(parsed.data, {
		toolCallId: 'moss-live-tool-call',
		messages: [],
	})
	return { result }
}
