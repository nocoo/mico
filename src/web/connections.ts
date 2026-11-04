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

function shapeStrokeHalfWidth(shape: CanvasShape | undefined): number {
	if (!shape) return 0
	return Number.isFinite(shape.strokeWidth) && (shape.strokeWidth as number) > 0
		? (shape.strokeWidth as number) / 2
		: 0
}

function trimPastRectangle(point: Point, end: Point, shape: CanvasShape, hitWorld: number): number {
	const dx = end.x - point.x
	const dy = end.y - point.y
	const length = Math.hypot(dx, dy)
	if (length === 0) return 0
	const unitX = dx / length
	const unitY = dy / length
	const expansion = shapeStrokeHalfWidth(shape) + hitWorld
	const minX = shape.x - expansion
	const maxX = shape.x + shape.w + expansion
	const minY = shape.y - expansion
	const maxY = shape.y + shape.h + expansion
	const candidates: number[] = []
	if (unitX > 0) candidates.push((maxX - point.x) / unitX)
	if (unitX < 0) candidates.push((minX - point.x) / unitX)
	if (unitY > 0) candidates.push((maxY - point.y) / unitY)
	if (unitY < 0) candidates.push((minY - point.y) / unitY)
	const positive = candidates.filter((distance) => distance > 1e-9)
	return positive.length > 0 ? Math.min(...positive) : 0
}

function trimPastEllipse(point: Point, end: Point, shape: CanvasShape, hitWorld: number): number {
	const dx = end.x - point.x
	const dy = end.y - point.y
	const length = Math.hypot(dx, dy)
	if (length === 0) return 0
	const unitX = dx / length
	const unitY = dy / length
	const expansion = shapeStrokeHalfWidth(shape) + hitWorld
	let high = Math.max(length * 2, 512)
	let low = 0
	for (let step = 0; step < 48; step++) {
		const distance = (low + high) / 2
		const candidate = { x: point.x + unitX * distance, y: point.y + unitY * distance }
		const proximity = ellipseProximity(candidate, shape)
		if (proximity.inside || proximity.distance < expansion) low = distance
		else high = distance
	}
	return high > 1e-9 ? high : 0
}

function trimPastShape(
	point: Point,
	end: Point,
	shape: CanvasShape | undefined,
	hitWorld: number,
): number {
	if (!shape || (shape.type !== 'rectangle' && shape.type !== 'ellipse')) return 0
	return shape.type === 'rectangle'
		? trimPastRectangle(point, end, shape, hitWorld)
		: trimPastEllipse(point, end, shape, hitWorld)
}

export function trimConnectorHitSegment(
	start: Point,
	end: Point,
	zoom: number,
	startShape?: CanvasShape,
	endShape?: CanvasShape,
): { start: Point; end: Point; short: boolean; safe?: boolean } {
	const dx = end.x - start.x
	const dy = end.y - start.y
	const length = Math.hypot(dx, dy)
	const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
	if (!Number.isFinite(length) || length === 0) {
		if (startShape || endShape) {
			return { start, end: start, short: true, safe: false }
		}
		const halfWorld = 4 / safeZoom
		return {
			start: { x: start.x - halfWorld, y: start.y },
			end: { x: start.x + halfWorld, y: start.y },
			short: true,
		}
	}

	const unitX = dx / length
	const unitY = dy / length

	if (!startShape && !endShape) {
		if (length <= 48 / safeZoom) {
			const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
			const halfWorld = Math.min(length / 4, 2 / safeZoom)
			return {
				start: { x: center.x - unitX * halfWorld, y: center.y - unitY * halfWorld },
				end: { x: center.x + unitX * halfWorld, y: center.y + unitY * halfWorld },
				short: true,
			}
		}
		const trimStart = 24 / safeZoom / length
		const trimEnd = 24 / safeZoom / length
		return {
			start: { x: start.x + dx * trimStart, y: start.y + dy * trimStart },
			end: { x: end.x - dx * trimEnd, y: end.y - dy * trimEnd },
			short: false,
		}
	}

	const narrowHitWorld = 2 / safeZoom
	const narrowStartTrim = trimPastShape(start, end, startShape, narrowHitWorld)
	const narrowEndTrim = trimPastShape(end, start, endShape, narrowHitWorld)
	const narrowStart = {
		x: start.x + unitX * narrowStartTrim,
		y: start.y + unitY * narrowStartTrim,
	}
	const narrowEnd = {
		x: end.x - unitX * narrowEndTrim,
		y: end.y - unitY * narrowEndTrim,
	}
	const narrowStartProjection =
		(narrowStart.x - start.x) * unitX + (narrowStart.y - start.y) * unitY
	const narrowEndProjection = (narrowEnd.x - start.x) * unitX + (narrowEnd.y - start.y) * unitY
	const narrowGap = narrowEndProjection > narrowStartProjection + 1e-9

	if (narrowGap) {
		if (length <= 48 / safeZoom) {
			return { start: narrowStart, end: narrowEnd, short: true, safe: true }
		}

		const hitWorld = 16 / safeZoom
		const geometryStartTrim = Math.max(
			24 / safeZoom,
			shapeStrokeHalfWidth(startShape),
			trimPastShape(start, end, startShape, hitWorld),
		)
		const geometryEndTrim = Math.max(
			24 / safeZoom,
			shapeStrokeHalfWidth(endShape),
			trimPastShape(end, start, endShape, hitWorld),
		)
		const geometryStart = {
			x: start.x + unitX * geometryStartTrim,
			y: start.y + unitY * geometryStartTrim,
		}
		const geometryEnd = {
			x: end.x - unitX * geometryEndTrim,
			y: end.y - unitY * geometryEndTrim,
		}
		const geometryStartProjection =
			(geometryStart.x - start.x) * unitX + (geometryStart.y - start.y) * unitY
		const geometryEndProjection =
			(geometryEnd.x - start.x) * unitX + (geometryEnd.y - start.y) * unitY
		if (geometryEndProjection > geometryStartProjection + 1e-9) {
			return { start: geometryStart, end: geometryEnd, short: false }
		}
		return { start: narrowStart, end: narrowEnd, short: false }
	}

	return {
		start: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
		end: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
		short: true,
		safe: false,
	}
}

export function findSnapTarget(
	shapes: Shape[],
	point: Point,
	excludedId: string,
	zoom: number,
): SnapTarget | null {
	const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
	let chosen: { shape: CanvasShape; proximity: Proximity; index: number } | undefined

	for (const [index, shape] of shapes.entries()) {
		if (shape.type === 'connector') continue
		if (shape.id === excludedId) continue
		if (!isFiniteShape(shape)) continue
		const proximity = shapeProximity(point, shape)
		const strokeHalfWidth =
			(shape.type === 'rectangle' || shape.type === 'ellipse') &&
			Number.isFinite(shape.strokeWidth) &&
			(shape.strokeWidth as number) > 0
				? (shape.strokeWidth as number) / 2
				: 0
		const effectiveDistance = proximity.inside
			? 0
			: Math.max(0, (proximity.distance - strokeHalfWidth) * scale)
		if (!proximity.inside && effectiveDistance > SNAP_DISTANCE_PX) continue

		if (!chosen) {
			chosen = { shape, proximity, index }
			continue
		}
		if (proximity.inside !== chosen.proximity.inside) {
			if (proximity.inside) chosen = { shape, proximity, index }
			continue
		}
		const chosenStrokeHalfWidth =
			(chosen.shape.type === 'rectangle' || chosen.shape.type === 'ellipse') &&
			Number.isFinite(chosen.shape.strokeWidth) &&
			(chosen.shape.strokeWidth as number) > 0
				? (chosen.shape.strokeWidth as number) / 2
				: 0
		const chosenEffectiveDistance = chosen.proximity.inside
			? 0
			: Math.max(0, (chosen.proximity.distance - chosenStrokeHalfWidth) * scale)
		if (
			effectiveDistance < chosenEffectiveDistance ||
			(effectiveDistance === chosenEffectiveDistance && index > chosen.index)
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
