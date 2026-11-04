import { randomUUID } from 'node:crypto'
import { tool } from 'ai'
import { z } from 'zod'
import { CANDY_COLORS, CANDY_LAYOUT, CANDY_TINTS } from '../shared/palette.ts'
import type { CanvasShape, Operation, Point, Shape } from '../shared/types.ts'
import { boardDigest } from './aiBoard.ts'
import { type BoardStore, OperationError } from './store.ts'

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

const noteColorSchema = z
	.enum([
		CANDY_TINTS.yellow,
		CANDY_TINTS.pink,
		CANDY_TINTS.green,
		CANDY_TINTS.blue,
		CANDY_TINTS.neutral,
	])
	.describe('Pale sticky-note fill.')

const frameIdSchema = idSchema
	.optional()
	.describe('Optional existing frame id; members must fit inside.')
const pointSchema = z.object({ x: z.number(), y: z.number() })
const coord = (label: string) => z.number().min(-100000).max(100000).describe(label)
const size = (label: string) => z.number().min(1).max(20000).describe(label)

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
	| { ok: false; error: string; message: string }

interface ToolContext {
	store: BoardStore
	broadcast: (event: unknown) => void
	selection: string[]
}

function apply(
	{ store, broadcast }: ToolContext,
	operations: Operation[],
): ToolReply | { ok: true; revision: number; updated: string[] } {
	if (operations.length === 0) {
		return { ok: true, revision: store.getBoard().revision, created: [] }
	}
	try {
		const result = store.applyRequest({ operations })
		broadcast({
			type: 'board',
			canvasId: result.canvasId,
			canvas: result.canvas,
			board: result.board,
		})
		const created = operations
			.filter(
				(operation): operation is Extract<Operation, { type: 'create' }> =>
					operation.type === 'create',
			)
			.map((operation) => ({ id: operation.shape.id, type: operation.shape.type }))
		const updated = operations
			.filter(
				(operation): operation is Extract<Operation, { type: 'update' }> =>
					operation.type === 'update',
			)
			.map((operation) => operation.id)
		return { ok: true, revision: result.board.revision, created, updated }
	} catch (error) {
		if (error instanceof OperationError) {
			return { ok: false, error: error.code, message: error.message }
		}
		throw error
	}
}

const baseShape = (id: string | undefined, kind: string, color: string) => ({
	id: id ?? generatedId(kind),
	color,
})

export function createCanvasTools(context: ToolContext) {
	const { store, selection } = context
	return {
		get_board: tool({
			description:
				'Read the current canvas: revision, bounds, the user selection, and every object with ids and geometry. Use it before starting, before connectors or rewrites, and near the end. Pass ids to inspect only specific objects.',
			inputSchema: z.object({
				ids: z.array(z.string()).max(40).optional().describe('Only return these object ids.'),
				include_html: z
					.boolean()
					.optional()
					.describe('Include the full HTML of selected html cards (max 6000 characters each).'),
			}),
			execute: async ({ ids, include_html }) => {
				const board = store.getBoard()
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
				return apply(context, operations)
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
							text: z.string().min(1).max(2000),
							color: noteColorSchema.optional(),
							frameId: frameIdSchema,
						}),
					)
					.min(1)
					.max(16),
			}),
			execute: async ({ notes }) => {
				const operations: Operation[] = notes.map((note) => ({
					type: 'create',
					shape: {
						...baseShape(note.id, 'note', note.color ?? CANDY_TINTS.yellow),
						type: 'note',
						x: note.x,
						y: note.y,
						w: note.w ?? 260,
						h: note.h ?? 180,
						text: note.text,
						...(note.frameId ? { frameId: note.frameId } : {}),
					},
				}))
				return apply(context, operations)
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
				return apply(context, operations)
			},
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
				return apply(context, operations)
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
				return apply(context, operations)
			},
		}),

		add_frames: tool({
			description:
				'Add a titled frame to group a stage, panel, comparison column or a whole lesson. Frames cannot nest. Leave 40px padding around members and pass frameId when creating members inside.',
			inputSchema: z.object({
				frames: z
					.array(
						z.object({
							id: idSchema.optional(),
							x: coord('Left edge.'),
							y: coord('Top edge.'),
							w: size('Width.'),
							h: size('Height.'),
							title: z.string().min(1).max(120),
							color: colorSchema.optional(),
						}),
					)
					.min(1)
					.max(8),
			}),
			execute: async ({ frames }) => {
				const operations: Operation[] = frames.map((frame) => ({
					type: 'create',
					shape: {
						...baseShape(frame.id, 'frame', frame.color ?? CANDY_COLORS.blue),
						type: 'frame',
						x: frame.x,
						y: frame.y,
						w: frame.w,
						h: frame.h,
						title: frame.title,
					},
				}))
				return apply(context, operations)
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
						}),
					)
					.min(1)
					.max(12),
			}),
			execute: async ({ strokes }) => {
				const operations: Operation[] = strokes.map((stroke) => {
					const xs = stroke.points.map((point) => point.x)
					const ys = stroke.points.map((point) => point.y)
					const left = Math.min(...xs)
					const top = Math.min(...ys)
					const w = Math.max(1, Math.max(...xs) - left)
					const h = Math.max(1, Math.max(...ys) - top)
					const points: Point[] = stroke.points.map((point) => ({
						x: Math.round((point.x - left) * 10) / 10,
						y: Math.round((point.y - top) * 10) / 10,
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
						},
					}
				})
				return apply(context, operations)
			},
		}),

		add_html_cards: tool({
			description:
				'Add a rich HTML card for precise tables, charts, annotated SVG diagrams, chemistry equations or formatted math. Use inline styles only; no scripts or external resources; keep markup under 12,000 characters.',
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
							html: z.string().min(1).max(12000),
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
						html: card.html,
						...(card.frameId ? { frameId: card.frameId } : {}),
					},
				}))
				return apply(context, operations)
			},
		}),

		update_shapes: tool({
			description:
				'Move, resize, recolor or relabel existing objects, reparent them into a frame, or rewire a connector. Patches are applied atomically. Keys must be valid for the object type.',
			inputSchema: z.object({
				updates: z
					.array(
						z.object({
							id: z.string().describe('Existing object id.'),
							patch: z
								.object({
									x: coord('Left edge.').optional(),
									y: coord('Top edge.').optional(),
									w: z.number().min(-20000).max(20000).optional(),
									h: z.number().min(-20000).max(20000).optional(),
									color: colorSchema.optional(),
									text: z.string().max(2000).optional(),
									title: z.string().min(1).max(120).optional(),
									html: z.string().min(1).max(12000).optional(),
									frameId: z.string().nullable().optional(),
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
				const operations: Operation[] = updates.map((update) => ({
					type: 'update',
					id: update.id,
					patch: update.patch,
				}))
				return apply(context, operations)
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
				const reply = apply(context, operations)
				if (!reply.ok) return reply
				return {
					ok: true as const,
					revision: store.getBoard().revision,
					deleted: ids,
				}
			},
		}),
	}
}
