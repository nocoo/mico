import type { CanvasShape, Point, Shape } from '../shared/types.ts'

export interface Rect {
	x: number
	y: number
	w: number
	h: number
}

interface Geometry {
	x: number
	y: number
	w: number
	h: number
}

const CANVAS_SHAPE_TYPES = new Set<string>([
	'rectangle',
	'ellipse',
	'text',
	'line',
	'path',
	'note',
	'html',
])

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object') return null
	return value as Record<string, unknown>
}

function geometryOf(value: unknown): Geometry | null {
	const record = asRecord(value)
	if (!record) return null
	if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)) return null
	if (!isFiniteNumber(record.w) || !isFiniteNumber(record.h)) return null
	return { x: record.x, y: record.y, w: record.w, h: record.h }
}

function boundsOfGeometry(geometry: Geometry): Rect {
	return {
		x: Math.min(geometry.x, geometry.x + geometry.w),
		y: Math.min(geometry.y, geometry.y + geometry.h),
		w: Math.abs(geometry.w),
		h: Math.abs(geometry.h),
	}
}

function union(a: Rect, b: Rect): Rect {
	const left = Math.min(a.x, b.x)
	const top = Math.min(a.y, b.y)
	const right = Math.max(a.x + a.w, b.x + b.w)
	const bottom = Math.max(a.y + a.h, b.y + b.h)
	return { x: left, y: top, w: right - left, h: bottom - top }
}

export function normalizeRect(a: Point, b: Point): Rect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		w: Math.abs(b.x - a.x),
		h: Math.abs(b.y - a.y),
	}
}

export function shapeBounds(shape: CanvasShape): Rect {
	const geometry = geometryOf(shape)
	if (!geometry) throw new RangeError('selection: shape geometry must be finite')
	return boundsOfGeometry(geometry)
}

export function intersects(a: Rect, b: Rect): boolean {
	const left = Math.min(a.x, a.x + a.w)
	const right = Math.max(a.x, a.x + a.w)
	const top = Math.min(a.y, a.y + a.h)
	const bottom = Math.max(a.y, a.y + a.h)
	const otherLeft = Math.min(b.x, b.x + b.w)
	const otherRight = Math.max(b.x, b.x + b.w)
	const otherTop = Math.min(b.y, b.y + b.h)
	const otherBottom = Math.max(b.y, b.y + b.h)
	return left <= otherRight && otherLeft <= right && top <= otherBottom && otherTop <= bottom
}

export function selectInRect(shapes: Shape[], rect: Rect): string[] {
	const geometry = geometryOf(rect)
	if (!geometry) return []
	const target = boundsOfGeometry(geometry)
	const selected: string[] = []
	const seen = new Set<string>()

	for (const shape of shapes ?? []) {
		const record = asRecord(shape)
		if (!record) continue
		const { id, type } = record
		if (typeof id !== 'string' || id.length === 0) continue
		if (typeof type !== 'string' || !CANVAS_SHAPE_TYPES.has(type)) continue
		const shapeGeometry = geometryOf(record)
		if (!shapeGeometry) continue
		if (!intersects(boundsOfGeometry(shapeGeometry), target)) continue
		if (seen.has(id)) continue
		seen.add(id)
		selected.push(id)
	}

	return selected
}

export function boundsOf(shapes: Shape[], ids: string[]): Rect | null {
	const wanted = new Set(ids ?? [])
	let bounds: Rect | null = null

	for (const shape of shapes ?? []) {
		const record = asRecord(shape)
		if (!record) continue
		const { id, type } = record
		if (typeof id !== 'string' || !wanted.has(id)) continue
		if (typeof type !== 'string' || !CANVAS_SHAPE_TYPES.has(type)) continue
		const geometry = geometryOf(record)
		if (!geometry) continue
		const shapeRect = boundsOfGeometry(geometry)
		bounds = bounds ? union(bounds, shapeRect) : shapeRect
	}

	return bounds
}

export function expandRect(rect: Rect, padding: number): Rect {
	if (!isFiniteNumber(padding) || padding < 0) {
		throw new RangeError('selection: padding must be a finite non-negative number')
	}
	return {
		x: rect.x - padding,
		y: rect.y - padding,
		w: rect.w + padding * 2,
		h: rect.h + padding * 2,
	}
}
