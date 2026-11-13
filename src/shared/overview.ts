import type { Shape, ShapeType } from './types.ts'

const OVERVIEW_TYPES = new Set([
	'note',
	'rectangle',
	'ellipse',
	'frame',
	'html',
	'image',
	'actions',
])
export const OVERVIEW_WIDTH = 176
export const OVERVIEW_HEIGHT = 116
const DEFAULT_WIDTH = OVERVIEW_WIDTH
const DEFAULT_HEIGHT = OVERVIEW_HEIGHT
const DEFAULT_PADDING = 12
const MAX_PROJECTED_BLOCKS = 240

function isOverviewType(type: ShapeType): type is OverviewBlock['type'] {
	return OVERVIEW_TYPES.has(type)
}

export interface OverviewBlock {
	id: string
	type: 'note' | 'rectangle' | 'ellipse' | 'frame' | 'html' | 'image' | 'actions'
	x: number
	y: number
	w: number
	h: number
	color: string
}

export interface OverviewRect {
	left: number
	top: number
	right: number
	bottom: number
}

export interface ProjectedOverviewBlock extends OverviewBlock {
	projectedX: number
	projectedY: number
	projectedWidth: number
	projectedHeight: number
}

export interface OverviewProjection {
	width: number
	height: number
	bounds: OverviewRect
	scale: number
	offsetX: number
	offsetY: number
	blocks: ProjectedOverviewBlock[]
}

export interface OverviewProjectionOptions {
	width?: number
	height?: number
	padding?: number
	maxScale?: number
	viewport?: OverviewRect
}

export interface OverviewCanvasSize {
	width: number
	height: number
	rightInset?: number
}

export interface OverviewViewport {
	x: number
	y: number
	zoom: number
}

function finitePositive(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback
}

function finiteSpan(start: number, end: number): number {
	const span = Math.abs(end - start)
	return Number.isFinite(span) ? span : Number.MAX_VALUE
}

function validRect(rect: OverviewRect): boolean {
	return [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
}

function clamp(value: number, minimum: number, maximum: number): number {
	if (!Number.isFinite(value)) return minimum
	return Math.max(minimum, Math.min(maximum, value))
}

export function extractOverviewBlocks(shapes: readonly Shape[]): OverviewBlock[] {
	const blocks: OverviewBlock[] = []
	for (const shape of shapes) {
		if (shape.type === 'connector' || !isOverviewType(shape.type)) continue
		const right = shape.x + shape.w
		const bottom = shape.y + shape.h
		if (![shape.x, shape.y, shape.w, shape.h, right, bottom].every(Number.isFinite)) continue
		blocks.push({
			id: shape.id,
			type: shape.type,
			x: Math.min(shape.x, right),
			y: Math.min(shape.y, bottom),
			w: Math.abs(shape.w),
			h: Math.abs(shape.h),
			color: shape.color.slice(0, 128),
		})
	}
	return [
		...blocks.filter((block) => block.type === 'frame'),
		...blocks.filter((block) => block.type !== 'frame'),
	]
}

function overviewBounds(blocks: readonly OverviewBlock[], viewport?: OverviewRect): OverviewRect {
	let left = Number.POSITIVE_INFINITY
	let top = Number.POSITIVE_INFINITY
	let right = Number.NEGATIVE_INFINITY
	let bottom = Number.NEGATIVE_INFINITY
	for (const block of blocks) {
		left = Math.min(left, block.x)
		top = Math.min(top, block.y)
		right = Math.max(right, block.x + block.w)
		bottom = Math.max(bottom, block.y + block.h)
	}
	if (viewport && validRect(viewport)) {
		left = Math.min(left, viewport.left)
		top = Math.min(top, viewport.top)
		right = Math.max(right, viewport.right)
		bottom = Math.max(bottom, viewport.bottom)
	}
	if (![left, top, right, bottom].every(Number.isFinite)) {
		return { left: 0, top: 0, right: 1, bottom: 1 }
	}
	return {
		left,
		top,
		right: right > left ? right : left + 1,
		bottom: bottom > top ? bottom : top + 1,
	}
}

export function projectOverviewBlocks(
	blocks: readonly OverviewBlock[],
	options: OverviewProjectionOptions = {},
): OverviewProjection {
	const width = finitePositive(options.width ?? DEFAULT_WIDTH, DEFAULT_WIDTH)
	const height = finitePositive(options.height ?? DEFAULT_HEIGHT, DEFAULT_HEIGHT)
	const padding = clamp(options.padding ?? DEFAULT_PADDING, 0, Math.min(width, height) / 2)
	const bounds = overviewBounds(blocks, options.viewport)
	const boardWidth = Math.max(1, finiteSpan(bounds.left, bounds.right))
	const boardHeight = Math.max(1, finiteSpan(bounds.top, bounds.bottom))
	const coordinateMagnitude = Math.max(
		Math.abs(bounds.left),
		Math.abs(bounds.top),
		Math.abs(bounds.right),
		Math.abs(bounds.bottom),
	)
	const coordinateScale = coordinateMagnitude
		? Number.MAX_VALUE / 4 / coordinateMagnitude
		: Number.POSITIVE_INFINITY
	const scale = Math.max(
		Number.EPSILON,
		Math.min(
			coordinateScale,
			options.maxScale ?? Number.POSITIVE_INFINITY,
			Math.max(0, width - padding * 2) / boardWidth,
			Math.max(0, height - padding * 2) / boardHeight,
		),
	)
	const centerX = bounds.left / 2 + bounds.right / 2
	const centerY = bounds.top / 2 + bounds.bottom / 2
	const offsetX = width / 2 - centerX * scale
	const offsetY = height / 2 - centerY * scale
	const projected = blocks.slice(0, MAX_PROJECTED_BLOCKS).map((block) => {
		const projectedWidth = clamp(finiteSpan(block.x, block.x + block.w) * scale, 2, width)
		const projectedHeight = clamp(finiteSpan(block.y, block.y + block.h) * scale, 2, height)
		return {
			...block,
			projectedX: clamp(block.x * scale + offsetX, 0, width - projectedWidth),
			projectedY: clamp(block.y * scale + offsetY, 0, height - projectedHeight),
			projectedWidth,
			projectedHeight,
		}
	})
	return { width, height, bounds, scale, offsetX, offsetY, blocks: projected }
}

export function overviewProjection(
	shapes: readonly Shape[],
	options: OverviewProjectionOptions = {},
): OverviewProjection {
	return projectOverviewBlocks(extractOverviewBlocks(shapes), options)
}

export function projectOverviewRect(
	projection: OverviewProjection,
	rect: OverviewRect,
): OverviewRect {
	return {
		left: clamp(rect.left * projection.scale + projection.offsetX, 0, projection.width),
		top: clamp(rect.top * projection.scale + projection.offsetY, 0, projection.height),
		right: clamp(rect.right * projection.scale + projection.offsetX, 0, projection.width),
		bottom: clamp(rect.bottom * projection.scale + projection.offsetY, 0, projection.height),
	}
}

export function canvasViewportRect(
	viewport: OverviewViewport,
	canvas: OverviewCanvasSize,
): OverviewRect {
	const width = finitePositive(canvas.width, 1)
	const height = finitePositive(canvas.height, 1)
	const zoom = finitePositive(viewport.zoom, 1)
	const availableWidth = Math.max(1, width - Math.max(0, canvas.rightInset ?? 0))
	const x = Number.isFinite(viewport.x) ? viewport.x : 0
	const y = Number.isFinite(viewport.y) ? viewport.y : 0
	return {
		left: -x / zoom,
		top: -y / zoom,
		right: (availableWidth - x) / zoom,
		bottom: (height - y) / zoom,
	}
}

export function overviewPointToWorld(projection: OverviewProjection, x: number, y: number) {
	const scale = finitePositive(projection.scale, 1)
	return {
		x: (clamp(x, 0, projection.width) - projection.offsetX) / scale,
		y: (clamp(y, 0, projection.height) - projection.offsetY) / scale,
	}
}

export function viewportCenteredOn(
	viewport: OverviewViewport,
	canvas: OverviewCanvasSize,
	center: { x: number; y: number },
): OverviewViewport {
	const width = finitePositive(canvas.width, 1)
	const height = finitePositive(canvas.height, 1)
	const availableWidth = Math.max(1, width - Math.max(0, canvas.rightInset ?? 0))
	const zoom = finitePositive(viewport.zoom, 1)
	return {
		x: availableWidth / 2 - (Number.isFinite(center.x) ? center.x : 0) * zoom,
		y: height / 2 - (Number.isFinite(center.y) ? center.y : 0) * zoom,
		zoom,
	}
}
