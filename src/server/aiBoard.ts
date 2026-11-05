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
	imageId?: string
	backgroundImageId?: string
	backgroundFit?: 'cover' | 'contain' | 'stretch'
}

const MAX_TEXT = 180
const MAX_HTML = 200000
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
		if (value !== undefined) digest[key] = clip(value, detailed ? 6000 : MAX_TEXT)
	}
	if (shape.frameId !== undefined) digest.frameId = shape.frameId
	if (shape.type === 'image' && shape.imageId) digest.imageId = shape.imageId
	if (shape.type === 'frame') {
		if (shape.backgroundImageId) digest.backgroundImageId = shape.backgroundImageId
		if (shape.backgroundFit) digest.backgroundFit = shape.backgroundFit
	}
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
		const interiorLimit = Math.max(0, limit - 2)
		const step = Math.max(1, Math.ceil(Math.max(0, points.length - 2) / Math.max(1, interiorLimit)))
		const interior: { x: number; y: number }[] = []
		for (
			let index = step;
			index < points.length - 1 && interior.length < interiorLimit;
			index += step
		) {
			interior.push(points[index])
		}
		const sampled = [points[0], ...interior, points[points.length - 1]]
		digest.samples = sampled.map((point) => ({
			x: round(shape.x + point.x),
			y: round(shape.y + point.y),
		}))
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
	warnings: string[]
}

function overlapRatio(a: BoardRect, b: BoardRect): number {
	const left = Math.max(a.x, b.x)
	const top = Math.max(a.y, b.y)
	const right = Math.min(a.x + a.w, b.x + b.w)
	const bottom = Math.min(a.y + a.h, b.y + b.h)
	if (right <= left || bottom <= top) return 0
	const area = (right - left) * (bottom - top)
	const smaller = Math.min(a.w * a.h, b.w * b.h)
	return smaller > 0 ? area / smaller : 0
}

function contains(outer: BoardRect, inner: BoardRect): boolean {
	return (
		inner.x >= outer.x - 1 &&
		inner.y >= outer.y - 1 &&
		inner.x + inner.w <= outer.x + outer.w + 1 &&
		inner.y + inner.h <= outer.y + outer.h + 1
	)
}

function layoutWarnings(shapes: Shape[]): string[] {
	const warnings: string[] = []
	const rects = new Map<string, BoardRect>()
	const frames = new Map<string, BoardRect>()
	for (const shape of shapes) {
		if (shape.type === 'connector') continue
		const rect = rectOf(shape)
		rects.set(shape.id, rect)
		if (shape.type === 'frame') frames.set(shape.id, rect)
	}
	for (const shape of shapes) {
		if (shape.type === 'connector' || !shape.frameId) continue
		const frame = frames.get(shape.frameId)
		const rect = rects.get(shape.id)
		if (frame && rect && !contains(frame, rect)) {
			warnings.push(
				`${shape.id} is outside its frame ${shape.frameId}; resize the frame or move the object`,
			)
		}
	}
	const content = shapes.filter((shape) => !['connector', 'frame', 'text'].includes(shape.type))
	for (let index = 0; index < content.length && warnings.length < 16; index++) {
		const a = content[index]
		const rectA = rects.get(a.id)
		if (!rectA) continue
		for (let peer = index + 1; peer < content.length && warnings.length < 16; peer++) {
			const b = content[peer]
			const rectB = rects.get(b.id)
			if (!rectB) continue
			const ratio = overlapRatio(rectA, rectB)
			if (ratio > 0.4) {
				warnings.push(
					`${a.id} overlaps ${b.id} (${Math.round(ratio * 100)}%); move or resize one of them`,
				)
			}
		}
	}
	return warnings.slice(0, 20)
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
		shapes: shapes.map((shape) => {
			const detailed = liveSelection.includes(shape.id) || Boolean(wanted?.has(shape.id))
			return digestShape(shape, options.includeHtml === true && detailed, detailed)
		}),
		omitted,
		warnings: layoutWarnings(board.shapes),
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
	lines.push(
		digest.warnings.length > 0
			? `Layout warnings: ${digest.warnings.join(' | ')}`
			: 'Layout warnings: none',
	)
	return lines.join('\n')
}

export function formatRect(rect: BoardRect | null): string {
	if (!rect) return 'empty board'
	return `x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}`
}
