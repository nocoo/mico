import type { Board, CanvasShape, Connector, Point, Shape } from '../shared/types.ts'
import { getAnchors } from './anchors.ts'

export interface SnapTarget {
	shapeId: string
	anchorIndex: number
	point: Point
}

const SNAP_DISTANCE_PX = 24

interface Proximity {
	inside: boolean
	distance: number
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const lengthSquared = dx * dx + dy * dy
	if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y)
	const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
	return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

function boxProximity(point: Point, shape: CanvasShape): Proximity {
	const minX = Math.min(shape.x, shape.x + shape.w)
	const maxX = Math.max(shape.x, shape.x + shape.w)
	const minY = Math.min(shape.y, shape.y + shape.h)
	const maxY = Math.max(shape.y, shape.y + shape.h)
	const inside = point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
	const dx = Math.max(minX - point.x, 0, point.x - maxX)
	const dy = Math.max(minY - point.y, 0, point.y - maxY)
	return { inside, distance: Math.hypot(dx, dy) }
}

function ellipseProximity(point: Point, shape: CanvasShape): Proximity {
	const centerX = shape.x + shape.w / 2
	const centerY = shape.y + shape.h / 2
	const radiusX = Math.abs(shape.w / 2)
	const radiusY = Math.abs(shape.h / 2)

	if (radiusX === 0 && radiusY === 0) {
		return { inside: false, distance: Math.hypot(point.x - centerX, point.y - centerY) }
	}
	if (radiusX === 0) {
		return {
			inside: false,
			distance: distanceToSegment(
				point,
				{ x: centerX, y: centerY - radiusY },
				{ x: centerX, y: centerY + radiusY },
			),
		}
	}
	if (radiusY === 0) {
		return {
			inside: false,
			distance: distanceToSegment(
				point,
				{ x: centerX - radiusX, y: centerY },
				{ x: centerX + radiusX, y: centerY },
			),
		}
	}

	const nx = (point.x - centerX) / radiusX
	const ny = (point.y - centerY) / radiusY
	const q = nx * nx + ny * ny
	if (q <= 1) return { inside: true, distance: 0 }
	const dx = point.x - centerX
	const dy = point.y - centerY
	const rx2 = radiusX * radiusX
	const ry2 = radiusY * radiusY
	let low = 0
	let high = Math.hypot(radiusX * dx, radiusY * dy)
	for (let step = 0; step < 48; step++) {
		const t = (low + high) / 2
		const level = ((radiusX * dx) / (t + rx2)) ** 2 + ((radiusY * dy) / (t + ry2)) ** 2
		if (level > 1) low = t
		else high = t
	}
	const x = (rx2 * dx) / (high + rx2)
	const y = (ry2 * dy) / (high + ry2)
	return { inside: false, distance: Math.hypot(dx - x, dy - y) }
}

function shapeProximity(point: Point, shape: CanvasShape): Proximity {
	if (shape.type === 'ellipse') return ellipseProximity(point, shape)
	if (shape.type === 'line') {
		return {
			inside: false,
			distance: distanceToSegment(
				point,
				{ x: shape.x, y: shape.y },
				{ x: shape.x + shape.w, y: shape.y + shape.h },
			),
		}
	}
	return boxProximity(point, shape)
}

function isFiniteShape(shape: CanvasShape): boolean {
	return (
		Number.isFinite(shape.x) &&
		Number.isFinite(shape.y) &&
		Number.isFinite(shape.w) &&
		Number.isFinite(shape.h)
	)
}

export function findSnapTarget(
	shapes: Shape[],
	point: Point,
	excludedId: string,
	zoom: number,
): SnapTarget | null {
	const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
	const threshold = SNAP_DISTANCE_PX / scale
	let chosen: { shape: CanvasShape; proximity: Proximity; index: number } | undefined

	for (const [index, shape] of shapes.entries()) {
		if (shape.type === 'connector') continue
		if (shape.id === excludedId) continue
		if (!isFiniteShape(shape)) continue
		const proximity = shapeProximity(point, shape)
		if (!proximity.inside && proximity.distance > threshold) continue

		if (!chosen) {
			chosen = { shape, proximity, index }
			continue
		}
		if (proximity.inside !== chosen.proximity.inside) {
			if (proximity.inside) chosen = { shape, proximity, index }
			continue
		}
		if (
			proximity.distance < chosen.proximity.distance ||
			(proximity.distance === chosen.proximity.distance && index > chosen.index)
		) {
			chosen = { shape, proximity, index }
		}
	}

	if (!chosen) return null

	const anchors = getAnchors(chosen.shape)
	let anchorIndex = 0
	let bestDistance = Number.POSITIVE_INFINITY
	for (const [index, anchor] of anchors.entries()) {
		const distance = (anchor.x - point.x) ** 2 + (anchor.y - point.y) ** 2
		if (distance < bestDistance) {
			bestDistance = distance
			anchorIndex = index
		}
	}
	return { shapeId: chosen.shape.id, anchorIndex, point: anchors[anchorIndex] }
}

export function canRebaseConnector(board: Board, original: Connector): boolean {
	const current = board.shapes.find((shape) => shape.id === original.id)
	if (current?.type !== 'connector') return false
	return (
		current.from === original.from &&
		current.to === original.to &&
		current.color === original.color &&
		current.fromAnchor === original.fromAnchor &&
		current.toAnchor === original.toAnchor
	)
}
