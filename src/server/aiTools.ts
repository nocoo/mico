import { randomUUID } from 'node:crypto'
import { tool } from 'ai'
import { z } from 'zod'
import {
	hasVisibleNoteLabel,
	NOTE_LABEL_SPACE,
	noteLabelHeightDelta,
} from '../shared/noteLayout.ts'
import { CANDY_COLORS, CANDY_LAYOUT, CANDY_TINTS } from '../shared/palette.ts'
import type { CanvasShape, Operation, Point, Shape } from '../shared/types.ts'
import { isMemberType } from '../shared/types.ts'
import { boardDigest } from './aiBoard.ts'
import { ImageGenerationService } from './imageGeneration.ts'
import {
	addedPlacement,
	connectorPlacementBounds,
	OperationError,
	type TenantStore,
} from './store.ts'
import { expandLucideIcons } from './summaryIcons.ts'

const idSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Use letters, digits, dash or underscore')
	.describe('Stable short id so later tool calls can reference this object, e.g. "axis-y".')

const colorSchema = z
	.enum([
		CANDY_COLORS.blue,
		CANDY_COLORS.green,
		CANDY_COLORS.yellow,
		CANDY_COLORS.pink,
		CANDY_COLORS.ink,
	])
	.describe('Outline or text color from the fixed palette.')

const anyColorSchema = z
	.enum([
		CANDY_COLORS.blue,
		CANDY_COLORS.green,
		CANDY_COLORS.yellow,
		CANDY_COLORS.pink,
		CANDY_COLORS.ink,
		CANDY_TINTS.yellow,
		CANDY_TINTS.pink,
		CANDY_TINTS.green,
		CANDY_TINTS.blue,
		CANDY_TINTS.neutral,
	])
	.describe('Palette color; notes use pale tints, other shapes use vivid outlines.')

const frameIdSchema = idSchema
	.optional()
	.describe(
		'Optional existing frame id; the AI must grow it to include the member with 40px padding.',
	)
const generationFrameIdSchema = idSchema
	.optional()
	.describe(
		'Optional existing frame id to receive the generated image as its background. The independent source image shape is placed separately in a clear area outside the frame; an existing frame background is never overwritten.',
	)
const pointSchema = z.object({ x: z.number(), y: z.number() })
const coord = (label: string) => z.number().describe(label)
const size = (label: string) => z.number().min(1).describe(label)

const NOTE_FILL: Record<string, string> = {
	[CANDY_COLORS.blue]: CANDY_TINTS.blue,
	[CANDY_COLORS.green]: CANDY_TINTS.green,
	[CANDY_COLORS.yellow]: CANDY_TINTS.yellow,
	[CANDY_COLORS.pink]: CANDY_TINTS.pink,
	[CANDY_COLORS.ink]: CANDY_TINTS.neutral,
}

function noteFill(color?: string): string {
	if (!color) return CANDY_TINTS.yellow
	return NOTE_FILL[color] ?? color
}

function actionCardHeight(items: { text: string }[], width: number): number {
	const textWidth = Math.max(1, width - 80)
	const contentHeight = items.reduce((height, item) => {
		const lines = item.text.split('\n').reduce((count, line) => {
			const pixels = Array.from(line).reduce(
				(total, character) => total + ((character.codePointAt(0) ?? 0) <= 0x7f ? 7.28 : 13),
				0,
			)
			return count + Math.max(1, Math.ceil(pixels / textWidth))
		}, 0)
		return height + Math.max(44, lines * 24 + 12)
	}, 0)
	return Math.max(120, 76 + contentHeight)
}

const generatedId = (kind: string): string => `${kind}-${randomUUID().slice(0, 8)}`

function textExtent(
	text: string,
	fontSize: number,
	w?: number,
	h?: number,
): { w: number; h: number } {
	if (w !== undefined && h !== undefined) return { w, h }
	const lines = text.split('\n')
	const widest = Math.max(
		...lines.map((line) => {
			let width = 0
			for (const char of line) {
				width += /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(char) ? fontSize : fontSize * 0.56
			}
			return width
		}),
	)
	return {
		w: w ?? Math.max(48, Math.ceil(widest + fontSize * 0.25)),
		h: h ?? Math.max(Math.ceil(fontSize * 1.4), Math.ceil(lines.length * fontSize * 1.35)),
	}
}

type ToolReply =
	| { ok: true; revision: number; created: { id: string; type: Shape['type'] }[] }
	| { ok: false; error: string; message: string; hint?: string }

interface ToolContext {
	store: TenantStore
	broadcast: (event: unknown) => void
	selection: string[]
	canvasId: string
	revision: number
	imageGeneration: ImageGenerationService
}

interface Bounds {
	left: number
	top: number
	right: number
	bottom: number
}

function shapeBounds(shape: Shape): Bounds | undefined {
	if (shape.type === 'connector') return undefined
	const left = shape.type === 'line' ? Math.min(shape.x, shape.x + shape.w) : shape.x
	const top = shape.type === 'line' ? Math.min(shape.y, shape.y + shape.h) : shape.y
	const right = shape.type === 'line' ? Math.max(shape.x, shape.x + shape.w) : shape.x + shape.w
	const bottom = shape.type === 'line' ? Math.max(shape.y, shape.y + shape.h) : shape.y + shape.h
	return { left, top, right, bottom }
}

function trueOverlap(a: Bounds, b: Bounds): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function touchOverlap(a: Bounds, b: Bounds): boolean {
	return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

function paddedMemberBounds(shapes: Shape[], frameId: string): Bounds | undefined {
	const memberBounds = shapes.flatMap((shape) => {
		if (shape.type === 'connector' || shape.frameId !== frameId) return []
		const bounds = shapeBounds(shape)
		return bounds ? [bounds] : []
	})
	if (memberBounds.length === 0) return undefined
	return {
		left: Math.min(...memberBounds.map((bounds) => bounds.left)) - 40,
		top: Math.min(...memberBounds.map((bounds) => bounds.top)) - 40,
		right: Math.max(...memberBounds.map((bounds) => bounds.right)) + 40,
		bottom: Math.max(...memberBounds.map((bounds) => bounds.bottom)) + 40,
	}
}

function projectOperations(current: Shape[], operations: Operation[]): Shape[] {
	const projected = current.map((shape) => ({ ...shape })) as Shape[]
	for (const operation of operations) {
		if (operation.type === 'create') {
			const index = projected.findIndex((shape) => shape.id === operation.shape.id)
			if (index >= 0) projected[index] = { ...operation.shape }
			else projected.push({ ...operation.shape })
			continue
		}
		if (operation.type === 'update') {
			const index = projected.findIndex((shape) => shape.id === operation.id)
			if (index < 0) continue
			const target = projected[index]
			const updated = { ...target, ...operation.patch } as Shape
			if (target.type === 'connector') {
				projected[index] = updated
				continue
			}
			if (target.type === 'note' && updated.type === 'note' && operation.patch.h === undefined) {
				updated.h += noteLabelHeightDelta(target.label, updated.label)
			}
			if (updated.type !== 'connector' && updated.frameId === null) {
				const { frameId: _frameId, ...rest } = updated
				projected[index] = rest as Shape
			} else if (updated.type === 'frame' && updated.backgroundImageId === null) {
				const { backgroundImageId: _backgroundImageId, ...rest } = updated
				projected[index] = rest as Shape
			} else {
				projected[index] = updated
			}
			continue
		}
		if (operation.type === 'set_action_done') {
			const index = projected.findIndex((shape) => shape.id === operation.id)
			const target = projected[index]
			if (target?.type === 'actions') {
				projected[index] = {
					...target,
					items:
						target.items?.map((item) =>
							item.id === operation.itemId ? { ...item, done: operation.done } : item,
						) ?? [],
				}
			}
			continue
		}
		if (operation.type === 'restore') {
			const index = projected.findIndex((shape) => shape.id === operation.shape.id)
			if (index >= 0) projected.splice(index, 1)
			projected.splice(operation.index, 0, { ...operation.shape })
		} else {
			const index = projected.findIndex((shape) => shape.id === operation.id)
			if (index >= 0) projected.splice(index, 1)
		}
	}
	return projected
}

function normalizeOperations(current: Shape[], operations: Operation[]): Operation[] {
	const byId = new Map<string, Shape>(current.map((shape) => [shape.id, shape]))
	const normalized: Operation[] = []
	for (const operation of operations) {
		if (operation.type !== 'create') {
			normalized.push(operation)
			continue
		}
		const existing = byId.get(operation.shape.id)
		if (!existing || existing.type !== operation.shape.type) {
			normalized.push(operation)
			byId.set(operation.shape.id, operation.shape)
			continue
		}
		if (operation.shape.type === 'connector') {
			normalized.push(
				{ type: 'delete', id: operation.shape.id },
				{ type: 'create', shape: operation.shape },
			)
			byId.set(operation.shape.id, operation.shape)
			continue
		}
		const { id: _id, type: _type, ...patch } = operation.shape
		normalized.push({
			type: 'update',
			id: operation.shape.id,
			patch: patch as Extract<Operation, { type: 'update' }>['patch'],
		})
		byId.set(operation.shape.id, operation.shape)
	}
	return normalized
}

async function apply(
	{ store, broadcast, canvasId }: ToolContext,
	operations: Operation[],
	observedRevision: number,
): Promise<ToolReply | { ok: true; revision: number; updated: string[] }> {
	if (operations.length === 0) {
		return { ok: true, revision: (await store.getBoard(canvasId)).revision, created: [] }
	}
	const current = await store.getBoard(canvasId)
	const normalized = normalizeOperations(current.shapes, operations)
	const projected = projectOperations(current.shapes, normalized)
	const explicitFrameIdCreates = normalized.some(
		(operation) =>
			operation.type === 'create' &&
			operation.shape.type !== 'connector' &&
			operation.shape.frameId !== undefined,
	)
	const mutatesExisting =
		normalized.some((operation) => operation.type !== 'create') || explicitFrameIdCreates
	if (mutatesExisting && current.revision !== observedRevision) {
		return {
			ok: false,
			error: 'REVISION_CONFLICT',
			message: `The board changed since your last read (revision ${observedRevision} → ${current.revision}). Call get_board and retry with the current layout.`,
		}
	}
	const frameIds = new Set<string>()
	for (const operation of normalized) {
		if (operation.type === 'create') {
			if (operation.shape.type === 'connector' || !isMemberType(operation.shape.type)) continue
			if (operation.shape.frameId !== undefined) frameIds.add(operation.shape.frameId)
			continue
		}
		if (operation.type !== 'update') continue
		const target = current.shapes.find((shape) => shape.id === operation.id)
		if (!target || target.type === 'connector' || !isMemberType(target.type)) continue
		if (operation.patch.frameId !== undefined && operation.patch.frameId !== null) {
			frameIds.add(operation.patch.frameId)
			continue
		}
		if (
			operation.patch.frameId === undefined &&
			target.frameId &&
			(operation.patch.x !== undefined ||
				operation.patch.y !== undefined ||
				operation.patch.w !== undefined ||
				operation.patch.h !== undefined)
		) {
			frameIds.add(target.frameId)
		}
	}

	for (const frameId of frameIds) {
		const frame = projected.find((shape) => shape.id === frameId)
		if (!frame) {
			return { ok: false, error: 'NOT_FOUND', message: `frame not found: ${frameId}` }
		}
		if (frame.type !== 'frame') {
			return {
				ok: false,
				error: 'INVALID_REQUEST',
				message: `frameId must reference a frame: ${frameId}`,
			}
		}
	}

	const growthCandidates = new Map<string, Bounds>()
	const growthOperations: Operation[] = []
	for (const frameId of frameIds) {
		const frame = projected.find((shape) => shape.id === frameId)
		if (frame?.type !== 'frame') continue
		const memberUnion = paddedMemberBounds(projected, frameId)
		if (!memberUnion) continue
		const frameBounds = shapeBounds(frame)
		if (!frameBounds) continue
		const candidate = {
			left: Math.min(frameBounds.left, memberUnion.left),
			top: Math.min(frameBounds.top, memberUnion.top),
			right: Math.max(frameBounds.right, memberUnion.right),
			bottom: Math.max(frameBounds.bottom, memberUnion.bottom),
		}
		const candidateW = candidate.right - candidate.left
		const candidateH = candidate.bottom - candidate.top
		if (
			candidate.left === frameBounds.left &&
			candidate.top === frameBounds.top &&
			candidate.right === frameBounds.right &&
			candidate.bottom === frameBounds.bottom
		) {
			continue
		}
		growthCandidates.set(frameId, candidate)

		for (const shape of projected) {
			if (shape.id === frameId) continue
			if (shape.type !== 'connector' && shape.frameId === frameId) continue
			if (shape.type === 'connector') {
				const from = projected.find((item) => item.id === shape.from)
				const to = projected.find((item) => item.id === shape.to)
				if (
					from &&
					from.type !== 'connector' &&
					from.frameId === frameId &&
					to &&
					to.type !== 'connector' &&
					to.frameId === frameId
				)
					continue
				const bounds = connectorPlacementBounds(projected, shape)
				const added = addedPlacement(
					{ ...frameBounds, top: frameBounds.top - 40 },
					{ ...candidate, top: candidate.top - 40 },
				)
				if (bounds && added.some((region) => touchOverlap(region, bounds))) {
					return {
						ok: false,
						error: 'FRAME_COLLISION',
						message: `Frame ${frameId} would touch unrelated connector ${shape.id}; growth is rejected without mutation.`,
					}
				}
				continue
			}
			const bounds = shapeBounds(shape)
			if (bounds && touchOverlap(candidate, bounds)) {
				return {
					ok: false,
					error: 'FRAME_COLLISION',
					message: `Frame ${frameId} would touch unrelated shape ${shape.id}; growth is rejected without mutation.`,
				}
			}
		}
		growthOperations.push({
			type: 'update',
			id: frameId,
			patch: { x: candidate.left, y: candidate.top, w: candidateW, h: candidateH },
		})
	}

	for (const [frameId, candidate] of growthCandidates) {
		for (const [otherId, other] of growthCandidates) {
			if (frameId === otherId) continue
			if (touchOverlap(candidate, other)) {
				return {
					ok: false,
					error: 'FRAME_COLLISION',
					message: `Frame ${frameId} would touch other frame ${otherId}; growth is rejected without mutation.`,
				}
			}
		}
	}

	const fullOperations = [...normalized, ...growthOperations]
	try {
		const result = await store.applyRequest({
			operations: fullOperations,
			canvasId,
			...(fullOperations.some((operation) => operation.type !== 'create')
				? { expectedRevision: observedRevision }
				: {}),
		})
		broadcast({
			type: 'board',
			canvasId: result.canvasId,
			canvas: result.canvas,
			board: result.board,
		})
		const created = normalized
			.filter(
				(operation): operation is Extract<Operation, { type: 'create' }> =>
					operation.type === 'create',
			)
			.map((operation) => ({ id: operation.shape.id, type: operation.shape.type }))
		const updated = normalized
			.filter(
				(operation): operation is Extract<Operation, { type: 'update' }> =>
					operation.type === 'update',
			)
			.map((operation) => operation.id)
		return { ok: true, revision: result.board.revision, created, updated }
	} catch (error) {
		if (error instanceof OperationError) {
			return {
				ok: false,
				error: error.code,
				message: error.message,
				...(error.code === 'DUPLICATE_ID'
					? {
							hint: 'Use update_shapes for the existing object, or choose a new id with a suffix such as -2.',
						}
					: {}),
			}
		}
		throw error
	}
}

const baseShape = (id: string | undefined, kind: string, color: string) => ({
	id: id ?? generatedId(kind),
	color,
})

const imageServices = new WeakMap<TenantStore, ImageGenerationService>()

export async function createCanvasTools(
	input: Omit<ToolContext, 'revision' | 'imageGeneration'> & {
		revision?: number
		imageGeneration?: ImageGenerationService
	},
) {
	const { store, selection, canvasId } = input
	let observedRevision = input.revision ?? (await store.getBoard(canvasId)).revision
	let imageGeneration = input.imageGeneration
	if (!imageGeneration) {
		imageGeneration = imageServices.get(store)
		if (!imageGeneration) {
			imageGeneration = new ImageGenerationService(store, input.broadcast)
			imageServices.set(store, imageGeneration)
		}
	}
	const context: ToolContext = { ...input, revision: observedRevision, imageGeneration }
	const applyOperations = async (operations: Operation[]) => {
		context.revision = observedRevision
		const reply = await apply(context, operations, observedRevision)
		if (reply.ok && operations.length > 0 && reply.revision === observedRevision + 1) {
			observedRevision = reply.revision
		}
		return reply
	}
	return {
		get_board: tool({
			description:
				'Read the current canvas: revision, bounds, the user selection, and every object with ids and geometry. Use it before starting, before connectors or rewrites, and near the end. Pass ids to inspect only specific objects; set include_html=true with ids to inspect existing card markup for safe edits.',
			inputSchema: z.object({
				ids: z.array(z.string()).max(40).optional().describe('Only return these object ids.'),
				include_html: z
					.boolean()
					.optional()
					.describe('Include the full HTML of selected html cards (max 6000 characters each).'),
			}),
			execute: async ({ ids, include_html }) => {
				const board = await store.getBoard(canvasId)
				observedRevision = board.revision
				return {
					ok: true,
					...boardDigest(board, selection, { ids, includeHtml: include_html === true }),
				}
			},
		}),

		add_texts: tool({
			description:
				'Add typographic text: lesson titles, headings, axis labels, short annotations or equations. Width and height are estimated from the text unless supplied; give enough size so nothing is clipped.',
			inputSchema: z.object({
				texts: z
					.array(
						z.object({
							id: idSchema.optional(),
							x: coord('Left edge in world pixels.'),
							y: coord('Top edge in world pixels.'),
							text: z.string().min(1).max(2000).describe('Text; use \\n for line breaks.'),
							w: size('Optional box width.').optional(),
							h: size('Optional box height.').optional(),
							color: colorSchema.optional(),
							fontSize: z.number().min(8).max(256).optional(),
							fontWeight: z.number().min(100).max(900).optional(),
							font: z.enum(['sans', 'serif', 'hand', 'mono']).optional(),
							frameId: frameIdSchema,
						}),
					)
					.min(1)
					.max(16),
			}),
			execute: async ({ texts }) => {
				const operations: Operation[] = texts.map((text) => {
					const fontSize = text.fontSize ?? 32
					const extent = textExtent(text.text, fontSize, text.w, text.h)
					const shape: CanvasShape = {
						...baseShape(text.id, 'text', text.color ?? CANDY_COLORS.ink),
						type: 'text',
						x: text.x,
						y: text.y,
						w: extent.w,
						h: extent.h,
						text: text.text,
						font: text.font ?? 'sans',
						fontSize,
						fontWeight: text.fontWeight ?? 500,
						...(text.frameId ? { frameId: text.frameId } : {}),
					}
					return { type: 'create', shape }
				})
				return applyOperations(operations)
			},
		}),

		add_notes: tool({
			description:
				'Add sticky notes for key facts, formulas, definitions, warnings or worked-example steps. Notes hold short multi-line text and a pale fill.',
			inputSchema: z.object({
				notes: z
					.array(
						z.object({
							id: idSchema.optional(),
							x: coord('Left edge.'),
							y: coord('Top edge.'),
							w: size('Width.').optional(),
							h: size('Height.').optional(),
							text: z.string().min(1).max(6000),
							label: z
								.string()
								.max(120)
								.optional()
								.describe('Optional short chip above the note body.'),
							color: anyColorSchema.optional(),
							frameId: frameIdSchema,
						}),
					)
					.min(1)
					.max(16),
			}),
			execute: async ({ notes }) => {
				const current = new Map(
					(await store.getBoard(canvasId)).shapes.map((shape) => [shape.id, shape]),
				)
				const operations: Operation[] = notes.map((note) => {
					const existing = note.id ? current.get(note.id) : undefined
					if (existing?.type === 'note') {
						return {
							type: 'update',
							id: existing.id,
							patch: {
								x: note.x,
								y: note.y,
								text: note.text,
								...(note.w === undefined ? {} : { w: note.w }),
								...(note.h === undefined ? {} : { h: note.h }),
								...(note.label === undefined ? {} : { label: note.label }),
								...(note.color === undefined ? {} : { color: noteFill(note.color) }),
								...(note.frameId === undefined ? {} : { frameId: note.frameId }),
							},
						}
					}
					return {
						type: 'create',
						shape: {
							...baseShape(note.id, 'note', noteFill(note.color)),
							type: 'note',
							x: note.x,
							y: note.y,
							w: note.w ?? 260,
							h: note.h ?? 180 + (hasVisibleNoteLabel(note.label) ? NOTE_LABEL_SPACE : 0),
							text: note.text,
							...(note.label !== undefined ? { label: note.label } : {}),
							...(note.frameId ? { frameId: note.frameId } : {}),
						},
					}
				})
				return applyOperations(operations)
			},
		}),

		add_boxes: tool({
			description:
				'Add labelled rectangles (process steps, concepts, quantities) or ellipses (objects, particles, states, cycles). A very short label goes inside the shape; use notes for paragraphs.',
			inputSchema: z.object({
				boxes: z
					.array(
						z.object({
							id: idSchema.optional(),
							kind: z.enum(['rectangle', 'ellipse']).optional().describe('Default rectangle.'),
							x: coord('Left edge.'),
							y: coord('Top edge.'),
							w: size('Width.'),
							h: size('Height.'),
							text: z
								.string()
								.max(300)
								.optional()
								.describe('Short label inside the shape; use notes for longer text.'),
							color: colorSchema.optional(),
							frameId: frameIdSchema,
						}),
					)
					.min(1)
					.max(16),
			}),
			execute: async ({ boxes }) => {
				const operations: Operation[] = boxes.map((box) => ({
					type: 'create',
					shape: {
						...baseShape(box.id, box.kind ?? 'rectangle', box.color ?? CANDY_COLORS.blue),
						type: box.kind ?? 'rectangle',
						x: box.x,
						y: box.y,
						w: box.w,
						h: box.h,
						...(box.text ? { text: box.text } : {}),
						...(box.frameId ? { frameId: box.frameId } : {}),
					},
				}))
				return applyOperations(operations)
			},
		}),

		add_images: tool({
			description:
				'Place one or more pre-uploaded binary images on the board using their asset imageId. Uploads happen outside this tool; never use remote URLs or fetch external resources.',
			inputSchema: z.object({
				images: z
					.array(
						z.object({
							id: idSchema.optional(),
							imageId: z.string().min(1).describe('Existing pre-uploaded image asset id.'),
							x: coord('Left edge.'),
							y: coord('Top edge.'),
							w: size('Width.'),
							h: size('Height.'),
							color: colorSchema.optional(),
							frameId: frameIdSchema,
						}),
					)
					.min(1)
					.max(16),
			}),
			execute: async ({ images }) => {
				const operations: Operation[] = images.map((image) => ({
					type: 'create',
					shape: {
						...baseShape(image.id, 'image', image.color ?? CANDY_COLORS.ink),
						type: 'image',
						imageId: image.imageId,
						x: image.x,
						y: image.y,
						w: image.w,
						h: image.h,
						...(image.frameId ? { frameId: image.frameId } : {}),
					},
				}))
				return applyOperations(operations)
			},
		}),

		generate_image: tool({
			description:
				'Start one asynchronous GPT Image 2.5 Flare generation on this canvas. The proposed position must be clear of objects and connectors; the tool returns immediately with a jobId and shapeId. If frameId identifies a frame, set the generated image as that frame background only if it has none; always keep the independent source image shape at a separate clear location outside the frame. Do not start another while it is busy. The result arrives only on image_generation_status or the board broadcast.',
			inputSchema: z.object({
				prompt: z
					.string()
					.min(1)
					.max(16384)
					.describe('Focused visual description for the generated PNG.'),
				aspect: z.enum(['1:1', '3:2', '2:3']).describe('Output aspect ratio.'),
				x: coord('Left edge of the proposed foreground image position.'),
				y: coord('Top edge of the proposed foreground image position.'),
				width: size('Image width in pixels.').max(4096),
				shapeId: idSchema
					.optional()
					.describe('Optional stable image shape id for the completed result.'),
				frameId: generationFrameIdSchema,
			}),
			execute: async ({ prompt, aspect, x, y, width, shapeId, frameId }) => {
				try {
					return await context.imageGeneration.start({
						prompt,
						aspect,
						canvasId,
						x,
						y,
						width,
						shapeId,
						frameId,
					})
				} catch (error) {
					if (error instanceof OperationError) {
						return { ok: false, error: error.code, message: error.message }
					}
					throw error
				}
			},
		}),

		image_generation_status: tool({
			description:
				'Read one image generation job, or the latest job when jobId is omitted. Status is pending, completed or failed; never infer success without completed status.',
			inputSchema: z.object({
				jobId: z.string().min(1).max(64).optional(),
			}),
			execute: async ({ jobId }) => context.imageGeneration.status(jobId),
		}),

		add_lines: tool({
			description:
				'Add straight lines: axes, rays, vectors, separators, timelines or construction lines. Lines take absolute start and end points and may have signed direction.',
			inputSchema: z.object({
				lines: z
					.array(
						z.object({
							id: idSchema.optional(),
							from: pointSchema.describe('Start point.'),
							to: pointSchema.describe('End point.'),
							color: colorSchema.optional(),
							frameId: frameIdSchema,
						}),
					)
					.min(1)
					.max(24),
			}),
			execute: async ({ lines }) => {
				const operations: Operation[] = lines.map((line) => ({
					type: 'create',
					shape: {
						...baseShape(line.id, 'line', line.color ?? CANDY_COLORS.green),
						type: 'line',
						x: line.from.x,
						y: line.from.y,
						w: line.to.x - line.from.x,
						h: line.to.y - line.from.y,
						...(line.frameId ? { frameId: line.frameId } : {}),
					},
				}))
				return applyOperations(operations)
			},
		}),

		add_connectors: tool({
			description:
				'Connect two existing objects with a directed connector (arrow). Both endpoints must already exist and both must be regular shapes, or both must be frames. Use short labels on the nodes instead of on the connector.',
			inputSchema: z.object({
				connectors: z
					.array(
						z.object({
							id: idSchema.optional(),
							from: z.string().describe('Existing source object id.'),
							to: z.string().describe('Existing target object id.'),
							color: colorSchema.optional(),
							fromAnchor: z.number().int().min(0).max(11).optional(),
							toAnchor: z.number().int().min(0).max(11).optional(),
						}),
					)
					.min(1)
					.max(24),
			}),
			execute: async ({ connectors }) => {
				const operations: Operation[] = connectors.map((connector) => ({
					type: 'create',
					shape: {
						...baseShape(connector.id, 'connector', connector.color ?? CANDY_LAYOUT.connector),
						type: 'connector',
						from: connector.from,
						to: connector.to,
						...(connector.fromAnchor !== undefined ? { fromAnchor: connector.fromAnchor } : {}),
						...(connector.toAnchor !== undefined ? { toAnchor: connector.toAnchor } : {}),
					},
				}))
				return applyOperations(operations)
			},
		}),

		add_frames: tool({
			description:
				'Add titled frames from at least two existing unframed regular objects. Frame bounds are computed from member geometry with 40px padding. The title bar occupies 40px above the top edge, outside the bounds; reserve at least 48px of clear space above each frame. For side-by-side frames, align top edges by aligning the topmost members of each group before framing where practical. Members are attached atomically; frames may not nest or overlap unrelated content or cover objects outside memberIds.',
			inputSchema: z.object({
				frames: z
					.array(
						z.object({
							id: idSchema.optional(),
							title: z.string().min(1).max(120),
							color: colorSchema.optional(),
							memberIds: z
								.array(idSchema)
								.min(2)
								.max(64)
								.describe('Existing unframed regular object ids; at least two distinct ids.'),
							backgroundImageId: z
								.string()
								.optional()
								.describe('Existing image shape id for the frame background.'),
							backgroundFit: z.enum(['cover', 'contain', 'stretch']).optional(),
						}),
					)
					.min(1)
					.max(8),
			}),
			execute: async ({ frames }) => {
				const current = await store.getBoard(canvasId)
				const allocatedIds = new Set(current.shapes.map((shape) => shape.id))
				const memberFrames = new Map<string, string>()
				const candidates: Array<{ id: string; bounds: Bounds; memberIds: Set<string> }> = []
				const operations: Operation[] = []

				for (const frame of frames) {
					let id = frame.id
					if (!id) {
						do id = generatedId('frame')
						while (allocatedIds.has(id))
					}
					if (allocatedIds.has(id)) {
						return {
							ok: false,
							error: 'DUPLICATE_ID',
							message: `shape id already exists: ${id}`,
						}
					}
					allocatedIds.add(id)

					const memberIds = new Set(frame.memberIds)
					if (memberIds.size < 2) {
						return {
							ok: false,
							error: 'INVALID_REQUEST',
							message: 'A frame requires at least two distinct existing regular member ids.',
						}
					}

					const memberBounds: Bounds[] = []
					for (const memberId of memberIds) {
						const member = current.shapes.find((shape) => shape.id === memberId)
						if (!member) {
							return { ok: false, error: 'NOT_FOUND', message: `shape not found: ${memberId}` }
						}
						if (member.type === 'connector' || !isMemberType(member.type)) {
							return {
								ok: false,
								error: 'INVALID_REQUEST',
								message: `shape is not a regular frame member: ${memberId}`,
							}
						}
						if (member.frameId) {
							return {
								ok: false,
								error: 'FRAME_MEMBER',
								message: `shape is already framed: ${memberId}`,
							}
						}
						if (memberFrames.has(memberId)) {
							return {
								ok: false,
								error: 'FRAME_MEMBER',
								message: `shape is already assigned to a frame in this batch: ${memberId}`,
							}
						}
						const bounds = shapeBounds(member)
						if (!bounds) {
							return {
								ok: false,
								error: 'INVALID_REQUEST',
								message: `shape has no bounds: ${memberId}`,
							}
						}
						memberFrames.set(memberId, id)
						memberBounds.push(bounds)
					}

					const bounds: Bounds = {
						left: Math.min(...memberBounds.map((bound) => bound.left)) - 40,
						top: Math.min(...memberBounds.map((bound) => bound.top)) - 40,
						right: Math.max(...memberBounds.map((bound) => bound.right)) + 40,
						bottom: Math.max(...memberBounds.map((bound) => bound.bottom)) + 40,
					}

					for (const candidate of candidates) {
						if (trueOverlap(bounds, candidate.bounds)) {
							return {
								ok: false,
								error: 'FRAME_COLLISION',
								message: `Frame ${id} overlaps other frame ${candidate.id}; frame creation is rejected without mutation.`,
							}
						}
					}
					for (const shape of current.shapes) {
						if (shape.type === 'connector' || memberIds.has(shape.id)) continue
						const unrelatedBounds = shapeBounds(shape)
						if (unrelatedBounds && trueOverlap(bounds, unrelatedBounds)) {
							return {
								ok: false,
								error: 'FRAME_COLLISION',
								message: `Frame ${id} overlaps unrelated shape ${shape.id}; frame creation is rejected without mutation.`,
							}
						}
					}
					candidates.push({ id, bounds, memberIds })

					operations.push({
						type: 'create',
						shape: {
							...baseShape(id, 'frame', frame.color ?? CANDY_COLORS.blue),
							type: 'frame',
							x: bounds.left,
							y: bounds.top,
							w: bounds.right - bounds.left,
							h: bounds.bottom - bounds.top,
							title: frame.title,
							...(frame.backgroundImageId
								? {
										backgroundImageId: frame.backgroundImageId,
										backgroundFit: frame.backgroundFit ?? 'cover',
									}
								: frame.backgroundFit
									? { backgroundFit: frame.backgroundFit }
									: {}),
						},
					})
					for (const memberId of memberIds) {
						operations.push({
							type: 'update',
							id: memberId,
							patch: { frameId: id },
						})
					}
				}
				return applyOperations(operations)
			},
		}),

		add_strokes: tool({
			description:
				'Draw freehand strokes: curves, arrows, underlines, orbits, field lines or sketch detail. Points are absolute world coordinates; the tool derives bounds. Use 2–200 points.',
			inputSchema: z.object({
				strokes: z
					.array(
						z.object({
							id: idSchema.optional(),
							points: z.array(pointSchema).min(2).max(200),
							color: colorSchema.optional(),
							brush: z.enum(['pencil', 'marker', 'brush']).optional(),
							strokeWidth: z.number().min(1).max(64).optional(),
							frameId: frameIdSchema,
						}),
					)
					.min(1)
					.max(12),
			}),
			execute: async ({ strokes }) => {
				const operations: Operation[] = strokes.map((stroke) => {
					const rounded: Point[] = stroke.points.map((point) => ({
						x: Math.round(point.x * 10) / 10,
						y: Math.round(point.y * 10) / 10,
					}))
					const xs = rounded.map((point) => point.x)
					const ys = rounded.map((point) => point.y)
					const left = Math.min(...xs)
					const top = Math.min(...ys)
					const w = Math.max(1, Math.max(...xs) - left)
					const h = Math.max(1, Math.max(...ys) - top)
					const points: Point[] = rounded.map((point) => ({
						x: point.x - left,
						y: point.y - top,
					}))
					return {
						type: 'create',
						shape: {
							...baseShape(stroke.id, 'stroke', stroke.color ?? CANDY_COLORS.ink),
							type: 'path',
							x: left,
							y: top,
							w,
							h,
							points,
							brush: stroke.brush ?? 'brush',
							strokeWidth: stroke.strokeWidth ?? 4,
							...(stroke.frameId ? { frameId: stroke.frameId } : {}),
						},
					}
				})
				return applyOperations(operations)
			},
		}),

		add_html_cards: tool({
			description:
				'Add a rich HTML card for tables, charts, diagrams or summaries. Bootstrap CSS and JavaScript are already embedded in the card; use their components and optional inline CSS or scripts. Do not load remote resources. Use exact Lucide placeholders such as <i data-lucide="heart-pulse"></i>; only the provided icon names may be used.',
			inputSchema: z.object({
				cards: z
					.array(
						z.object({
							id: idSchema.optional(),
							x: coord('Left edge.'),
							y: coord('Top edge.'),
							w: size('Width.'),
							h: size('Height.'),
							title: z.string().min(1).max(120),
							html: z.string().min(1).max(40000),
							color: colorSchema.optional(),
							frameId: frameIdSchema,
						}),
					)
					.min(1)
					.max(4),
			}),
			execute: async ({ cards }) => {
				const operations: Operation[] = cards.map((card) => ({
					type: 'create',
					shape: {
						...baseShape(card.id, 'card', card.color ?? CANDY_COLORS.blue),
						type: 'html',
						x: card.x,
						y: card.y,
						w: card.w,
						h: card.h,
						title: card.title,
						html: expandLucideIcons(card.html),
						...(card.frameId ? { frameId: card.frameId } : {}),
					},
				}))
				return applyOperations(operations)
			},
		}),

		upsert_action_card: tool({
			description:
				'Create or update one action card. Supply stable card and item ids. On first create, provide x and y; an empty items array is valid when the source contains no real action items, and must not be filled with invented tasks. Later calls upsert only the returned items and must list deletions explicitly in removeItemIds; omitted existing items are preserved. Never send or change done; completion remains UI-controlled.',
			inputSchema: z
				.object({
					id: idSchema,
					title: z.string().min(1).max(120),
					items: z
						.array(
							z
								.object({
									id: idSchema,
									text: z.string().min(1).max(1000),
								})
								.strict(),
						)
						.max(200)
						.superRefine((items, context) => {
							const ids = new Set<string>()
							for (const [index, item] of items.entries()) {
								if (!ids.has(item.id)) {
									ids.add(item.id)
									continue
								}
								context.addIssue({
									code: 'custom',
									message: 'Action item ids must be unique within the card',
									path: [index, 'id'],
								})
							}
						}),
					x: coord('Left edge on first create.').optional(),
					y: coord('Top edge on first create.').optional(),
					w: size('Width.').optional(),
					h: size('Height.').optional(),
					removeItemIds: z.array(idSchema).max(200).optional(),
					color: z.enum([...Object.values(CANDY_COLORS), ...Object.values(CANDY_TINTS)]).optional(),
					frameId: z.string().nullable().optional(),
				})
				.strict(),
			execute: async (card) => {
				const current = await store.getBoard(canvasId)
				const existing = current.shapes.find((shape) => shape.id === card.id)
				if (existing && existing.type !== 'actions') {
					return {
						ok: false as const,
						error: 'DUPLICATE_ID',
						message: `shape id already exists with type ${existing.type}: ${card.id}`,
					}
				}
				if (!existing && (card.x === undefined || card.y === undefined)) {
					return {
						ok: false as const,
						error: 'INVALID_REQUEST',
						message: 'x and y are required when creating an action card',
					}
				}
				const previous = new Map(
					existing?.type === 'actions' ? existing.items?.map((item) => [item.id, item]) : [],
				)
				const removeItemIds = new Set(card.removeItemIds ?? [])
				if (!existing && removeItemIds.size > 0) {
					return {
						ok: false as const,
						error: 'INVALID_REQUEST',
						message: 'removeItemIds is only valid when updating an existing action card',
					}
				}
				if (
					existing?.type === 'actions' &&
					[...removeItemIds].some((id) => !existing.items?.some((item) => item.id === id))
				) {
					return {
						ok: false as const,
						error: 'NOT_FOUND',
						message: 'removeItemIds contains an action item that does not exist on this card',
					}
				}
				for (const item of card.items) {
					if (removeItemIds.has(item.id)) {
						return {
							ok: false as const,
							error: 'INVALID_REQUEST',
							message: `action item cannot be updated and removed in one call: ${item.id}`,
						}
					}
				}
				const updates = new Map(
					card.items.map((item) => [
						item.id,
						{ ...item, done: previous.get(item.id)?.done ?? false },
					]),
				)
				const items = [
					...(existing?.type === 'actions' ? (existing.items ?? []) : []).flatMap((item) => {
						if (removeItemIds.has(item.id)) return []
						const update = updates.get(item.id)
						if (update) {
							updates.delete(item.id)
							return [{ ...update }]
						}
						return [{ ...item }]
					}),
					...[...updates.values()],
				]
				const width = card.w ?? (existing?.type === 'actions' ? existing.w : undefined) ?? 300
				if (!existing) {
					return applyOperations([
						{
							type: 'create',
							shape: {
								...baseShape(card.id, 'actions', card.color ?? CANDY_TINTS.green),
								type: 'actions',
								x: card.x as number,
								y: card.y as number,
								w: width,
								h: Math.max(card.h ?? 0, actionCardHeight(items, width)),
								title: card.title,
								items,
								...(card.frameId ? { frameId: card.frameId } : {}),
							},
						},
					])
				}
				return applyOperations([
					{
						type: 'update',
						id: card.id,
						patch: {
							title: card.title,
							items,
							...(card.x === undefined ? {} : { x: card.x }),
							...(card.y === undefined ? {} : { y: card.y }),
							...(card.w === undefined ? {} : { w: card.w }),
							h: Math.max(card.h ?? 0, existing.h, actionCardHeight(items, width)),
							...(card.color === undefined ? {} : { color: card.color }),
							...(card.frameId === undefined ? {} : { frameId: card.frameId }),
						},
					},
				])
			},
		}),

		update_shapes: tool({
			description:
				'Move, resize, recolor or relabel existing objects, reparent them into a frame, set or unlink frame backgroundImageId, choose backgroundFit, or rewire a connector. Patches are applied atomically. Keys must be valid for the object type. For HTML patches, use exact Lucide placeholders such as <i data-lucide="heart-pulse"></i>.',
			inputSchema: z.object({
				updates: z
					.array(
						z.object({
							id: z.string().describe('Existing object id.'),
							patch: z
								.object({
									x: coord('Left edge.').optional(),
									y: coord('Top edge.').optional(),
									w: z.number().optional(),
									h: z.number().optional(),
									color: anyColorSchema.optional(),
									text: z.string().max(6000).optional(),
									label: z.string().max(120).optional(),
									title: z.string().min(1).max(120).optional(),
									html: z.string().min(1).max(200000).optional(),
									frameId: z.string().nullable().optional(),
									imageId: z.string().min(1).optional(),
									backgroundImageId: z.string().nullable().optional(),
									backgroundFit: z.enum(['cover', 'contain', 'stretch']).optional(),
									font: z.enum(['sans', 'serif', 'hand', 'mono']).optional(),
									fontSize: z.number().min(8).max(256).optional(),
									fontWeight: z.number().min(100).max(900).optional(),
									from: z.string().optional(),
									to: z.string().optional(),
									fromAnchor: z.number().int().min(0).max(11).optional(),
									toAnchor: z.number().int().min(0).max(11).optional(),
								})
								.describe('Only include the properties to change.'),
						}),
					)
					.min(1)
					.max(24),
			}),
			execute: async ({ updates }) => {
				const shapes = new Map(
					(await store.getBoard(canvasId)).shapes.map((shape) => [shape.id, shape]),
				)
				const operations: Operation[] = updates.map((update) => {
					const color =
						update.patch.color === undefined
							? undefined
							: shapes.get(update.id)?.type === 'note'
								? noteFill(update.patch.color)
								: update.patch.color
					return {
						type: 'update',
						id: update.id,
						patch: {
							...update.patch,
							...(color === undefined ? {} : { color }),
							...(update.patch.html === undefined
								? {}
								: { html: expandLucideIcons(update.patch.html) }),
						},
					}
				})
				return applyOperations(operations)
			},
		}),

		delete_shapes: tool({
			description:
				"Delete objects you created by mistake or duplicates. Never delete the user's existing or selected objects unless explicitly asked.",
			inputSchema: z.object({
				ids: z.array(z.string()).min(1).max(24),
			}),
			execute: async ({ ids }) => {
				const operations: Operation[] = ids.map((id) => ({ type: 'delete', id }))
				const reply = await applyOperations(operations)
				if (!reply.ok) return reply
				return {
					ok: true as const,
					revision: observedRevision,
					deleted: ids,
				}
			},
		}),
	}
}
