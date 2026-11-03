import type { CanvasShape } from '../shared/types.ts'

interface Point {
	x: number
	y: number
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
): { start: Point; end: Point } {
	const starts = getAnchors(from)
	const ends = getAnchors(to)
	let best: { start: Point; end: Point; distance: number } | undefined
	let nearest: { start: Point; end: Point; distance: number } | undefined

	for (const [startIndex, start] of starts.entries()) {
		for (const [endIndex, end] of ends.entries()) {
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
