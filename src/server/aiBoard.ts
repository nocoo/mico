import type { Board, CanvasShape, Shape } from '../shared/types.ts'

export interface BoardRect {
	x: number
	y: number
	w: number
	h: number
}

export interface ShapeDigest {
	id: string
	type: Shape['type']
	x?: number
	y?: number
	w?: number
	h?: number
	color?: string
	text?: string
	title?: string
	frameId?: string
	font?: string
	fontSize?: number
	fontWeight?: number
	from?: string
	to?: string
	fromAnchor?: number
	toAnchor?: number
	brush?: string
	strokeWidth?: number
	points?: number
	samples?: { x: number; y: number }[]
	start?: { x: number; y: number }
	end?: { x: number; y: number }
	html?: string
	htmlLength?: number
}

const MAX_TEXT = 180
const MAX_HTML = 6000
const MAX_SHAPES = 150

export function clip(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

const round = (value: number): number => Math.round(value * 10) / 10

function rectOf(shape: CanvasShape): BoardRect {
	const left = Math.min(shape.x, shape.x + shape.w)
	const top = Math.min(shape.y, shape.y + shape.h)
	return {
		x: round(left),
		y: round(top),
		w: round(Math.abs(shape.w)),
		h: round(Math.abs(shape.h)),
	}
}

export function boardBounds(shapes: Shape[]): BoardRect | null {
	let left = Number.POSITIVE_INFINITY
	let top = Number.POSITIVE_INFINITY
	let right = Number.NEGATIVE_INFINITY
	let bottom = Number.NEGATIVE_INFINITY
	for (const shape of shapes) {
		if (shape.type === 'connector') continue
		const rect = rectOf(shape)
		left = Math.min(left, rect.x)
		top = Math.min(top, rect.y)
		right = Math.max(right, rect.x + rect.w)
		bottom = Math.max(bottom, rect.y + rect.h)
	}
	if (!Number.isFinite(left)) return null
	return {
		x: round(left),
		y: round(top),
		w: round(Math.abs(right - left)),
		h: round(Math.abs(bottom - top)),
	}
}

export function digestShape(shape: Shape, includeHtml = false, detailed = false): ShapeDigest {
	const digest: ShapeDigest = { id: shape.id, type: shape.type }
	if (shape.type === 'connector') {
		digest.color = shape.color
		digest.from = shape.from
		digest.to = shape.to
		if (shape.fromAnchor !== undefined) digest.fromAnchor = shape.fromAnchor
		if (shape.toAnchor !== undefined) digest.toAnchor = shape.toAnchor
		return digest
	}
	Object.assign(digest, rectOf(shape), { color: shape.color })
	for (const key of ['text', 'title'] as const) {
		const value = shape[key]
		if (value !== undefined) digest[key] = clip(value, MAX_TEXT)
	}
	if (shape.frameId !== undefined) digest.frameId = shape.frameId
	if (shape.type === 'text') {
		if (shape.font !== undefined) digest.font = shape.font
		if (shape.fontSize !== undefined) digest.fontSize = shape.fontSize
		if (shape.fontWeight !== undefined) digest.fontWeight = shape.fontWeight
	}
	if (shape.type === 'line') {
		digest.start = { x: round(shape.x), y: round(shape.y) }
		digest.end = { x: round(shape.x + shape.w), y: round(shape.y + shape.h) }
	}
	if (shape.type === 'path') {
		digest.brush = shape.brush
		digest.strokeWidth = shape.strokeWidth
		const points = shape.points ?? []
		digest.points = points.length
		const limit = detailed ? 32 : 8
		const step = Math.max(1, Math.ceil(points.length / limit))
		digest.samples = points
			.filter((_, index) => index % step === 0 || index === points.length - 1)
			.slice(0, limit)
			.map((point) => ({ x: round(shape.x + point.x), y: round(shape.y + point.y) }))
	}
	if (shape.type === 'html') {
		const html = shape.html ?? ''
		digest.htmlLength = html.length
		if (includeHtml) digest.html = clip(html, MAX_HTML)
	}
	return digest
}

export interface BoardDigest {
	revision: number
	count: number
	bounds: BoardRect | null
	selection: string[]
	shapes: ShapeDigest[]
	omitted: number
}

export function boardDigest(
	board: Board,
	selection: string[],
	options: { includeHtml?: boolean; ids?: string[] } = {},
): BoardDigest {
	const wanted = options.ids ? new Set(options.ids) : null
	const liveSelection = selection.filter((id) => board.shapes.some((shape) => shape.id === id))
	let shapes = wanted ? board.shapes.filter((shape) => wanted.has(shape.id)) : board.shapes
	const omitted = Math.max(0, shapes.length - MAX_SHAPES)
	if (omitted > 0) shapes = shapes.slice(-MAX_SHAPES)
	return {
		revision: board.revision,
		count: board.shapes.length,
		bounds: boardBounds(board.shapes),
		selection: liveSelection,
		shapes: shapes.map((shape) =>
			digestShape(
				shape,
				options.includeHtml === true && liveSelection.includes(shape.id),
				liveSelection.includes(shape.id),
			),
		),
		omitted,
	}
}

export function selectedDigests(board: Board, selection: string[]): ShapeDigest[] {
	const wanted = new Set(selection)
	return board.shapes
		.filter((shape) => wanted.has(shape.id))
		.map((shape) => digestShape(shape, true, true))
}

export function formatBoardContext(board: Board, selection: string[]): string {
	const selected = selectedDigests(board, selection)
	const digest = boardDigest(board, selection, { includeHtml: false })
	const lines = [
		`Board revision ${digest.revision}; ${digest.count} objects; bounds ${formatRect(digest.bounds)}.`,
		`User selection (${selected.length}): ${selection.length === 0 ? 'none' : selection.join(', ')}`,
	]
	if (selected.length > 0) {
		lines.push(
			'Selected objects are the primary context. Extend or refine them; do not delete them.',
		)
		lines.push(`Selection detail: ${JSON.stringify(selected)}`)
	}
	lines.push(`Board objects: ${JSON.stringify(digest.shapes)}`)
	if (digest.omitted > 0) lines.push(`(${digest.omitted} older objects omitted.)`)
	return lines.join('\n')
}

export function formatRect(rect: BoardRect | null): string {
	if (!rect) return 'empty board'
	return `x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}`
}
