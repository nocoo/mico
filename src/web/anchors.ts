import type { CanvasShape } from '../shared/types.ts'

export interface Point {
	x: number
	y: number
}

export interface AnchorTarget {
	shapeId: string
	index: number
	point: Point
}

const fractions = [0.5, 1 / 3, 2 / 3]

export function getAnchors(shape: CanvasShape): Point[] {
	if (shape.type === 'line') {
		return [0, ...fractions, 1].map((fraction) => ({
			x: shape.x + shape.w * fraction,
			y: shape.y + shape.h * fraction,
		}))
	}

	const centerX = shape.x + shape.w / 2
	const centerY = shape.y + shape.h / 2
	const radiusX = shape.w / 2
	const radiusY = shape.h / 2
	const points: Point[] = []

	for (const fraction of fractions) {
		const offset = fraction * 2 - 1
		const ellipseScale = shape.type === 'ellipse' ? Math.sqrt(1 - offset * offset) : 1
		points.push(
			{ x: shape.x + shape.w * fraction, y: centerY - radiusY * ellipseScale },
			{ x: shape.x + shape.w * fraction, y: centerY + radiusY * ellipseScale },
			{ x: centerX - radiusX * ellipseScale, y: shape.y + shape.h * fraction },
			{ x: centerX + radiusX * ellipseScale, y: shape.y + shape.h * fraction },
		)
	}

	return points
}

export function getAnchorNormal(shape: CanvasShape, index: number): Point {
	if (shape.type === 'line' || !shape.w || !shape.h) return { x: 0, y: 0 }
	if (shape.type !== 'ellipse') {
		return [
			{ x: 0, y: -1 },
			{ x: 0, y: 1 },
			{ x: -1, y: 0 },
			{ x: 1, y: 0 },
		][index % 4]
	}
	const point = getAnchors(shape)[index]
	const rx = shape.w / 2
	const ry = shape.h / 2
	const x = (point.x - shape.x - rx) / (rx * rx)
	const y = (point.y - shape.y - ry) / (ry * ry)
	const length = Math.hypot(x, y)
	return length ? { x: x / length, y: y / length } : { x: 0, y: 0 }
}

export function findClosestAnchor(
	shapes: CanvasShape[],
	point: Point,
	excludedShapeId: string,
	maxDistance: number,
): AnchorTarget | null {
	let nearest: AnchorTarget | null = null
	let minDistance = maxDistance * maxDistance
	for (const shape of [...shapes].reverse()) {
		if (shape.id === excludedShapeId) continue
		for (const [index, anchor] of getAnchors(shape).entries()) {
			const dx = point.x - anchor.x
			const dy = point.y - anchor.y
			const distance = dx * dx + dy * dy
			if (distance <= minDistance && (!nearest || distance < minDistance)) {
				nearest = { shapeId: shape.id, index, point: anchor }
				minDistance = distance
			}
		}
	}
	return nearest
}

function facesOutward(
	shape: CanvasShape,
	anchor: Point,
	index: number,
	dx: number,
	dy: number,
): boolean {
	if (shape.type === 'line' || !shape.w || !shape.h) return true
	if (shape.type === 'ellipse') {
		const rx = shape.w / 2
		const ry = shape.h / 2
		const nx = (anchor.x - shape.x - rx) / rx
		const ny = (anchor.y - shape.y - ry) / ry
		return nx * (dx / rx) + ny * (dy / ry) > 1e-9
	}
	const projection = [-dy, dy, -dx, dx][index % 4]
	return projection > 1e-9
}

export function getConnectorAnchors(
	from: CanvasShape,
	to: CanvasShape,
	fromAnchor?: number,
	toAnchor?: number,
): { start: Point; end: Point } {
	const fromAnchors = getAnchors(from)
	const toAnchors = getAnchors(to)
	if (
		fromAnchor !== undefined &&
		(!Number.isInteger(fromAnchor) || fromAnchor < 0 || fromAnchor >= fromAnchors.length)
	) {
		throw new Error(`Invalid fromAnchor: ${fromAnchor}`)
	}
	if (
		toAnchor !== undefined &&
		(!Number.isInteger(toAnchor) || toAnchor < 0 || toAnchor >= toAnchors.length)
	) {
		throw new Error(`Invalid toAnchor: ${toAnchor}`)
	}

	if (fromAnchor !== undefined && toAnchor !== undefined) {
		return { start: fromAnchors[fromAnchor], end: toAnchors[toAnchor] }
	}

	let best: { start: Point; end: Point; distance: number } | undefined
	let nearest: { start: Point; end: Point; distance: number } | undefined

	for (const [startIndex, start] of fromAnchors.entries()) {
		if (fromAnchor !== undefined && startIndex !== fromAnchor) continue
		for (const [endIndex, end] of toAnchors.entries()) {
			if (toAnchor !== undefined && endIndex !== toAnchor) continue
			const dx = end.x - start.x
			const dy = end.y - start.y
			const distance = dx * dx + dy * dy
			if (!nearest || distance < nearest.distance) nearest = { start, end, distance }
			if (
				(!best || distance < best.distance) &&
				facesOutward(from, start, startIndex, dx, dy) &&
				facesOutward(to, end, endIndex, -dx, -dy)
			) {
				best = { start, end, distance }
			}
		}
	}
	const chosen = best ?? nearest
	if (!chosen) throw new Error('A shape must have at least one anchor')
	return { start: chosen.start, end: chosen.end }
}
