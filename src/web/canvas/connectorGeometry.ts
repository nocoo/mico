import type { CanvasShape, Connector } from '../../shared/types.ts'
import { type AnchorPins, getAnchors, getConnectorAnchors, type Point } from '../anchors.ts'

export interface ConnectorGeometry {
	start: Point
	controlStart: Point
	controlEnd: Point
	end: Point
}

export interface ConnectorVisualGeometry extends ConnectorGeometry {
	arrowTip: Point
	showArrow: boolean
}

export interface ConnectorBounds {
	left: number
	right: number
	top: number
	bottom: number
}

const EPSILON = 1e-9
const ENDPOINT_GAP = 4
const ARROW_LENGTH = 9
const MIN_ARROW_DISTANCE = 18

function direction(x: number, y: number, fallback: Point): Point {
	const length = Math.hypot(x, y)
	if (length > EPSILON) return { x: x / length, y: y / length }
	return fallback
}

function fallbackDirection(from: Point, to: Point): Point {
	return direction(to.x - from.x, to.y - from.y, { x: 1, y: 0 })
}

function anchorIndex(shape: CanvasShape, point: Point, pin?: number): number {
	if (pin !== undefined) return pin
	return getAnchors(shape).findIndex(
		(anchor) => Math.abs(anchor.x - point.x) <= EPSILON && Math.abs(anchor.y - point.y) <= EPSILON,
	)
}

function outwardDirection(
	shape: CanvasShape,
	point: Point,
	pin: number | undefined,
	fallback: Point,
): Point {
	const index = anchorIndex(shape, point, pin)
	if (shape.type === 'ellipse') {
		const radiusX = Math.abs(shape.w / 2)
		const radiusY = Math.abs(shape.h / 2)
		if (radiusX > EPSILON && radiusY > EPSILON) {
			const centerX = shape.x + shape.w / 2
			const centerY = shape.y + shape.h / 2
			return direction(
				(point.x - centerX) / (radiusX * radiusX),
				(point.y - centerY) / (radiusY * radiusY),
				fallback,
			)
		}
	}
	if (shape.type !== 'line' && index >= 0) {
		switch (index % 4) {
			case 0:
				return { x: 0, y: shape.h === 0 ? -Math.abs(fallback.y || 1) : -Math.sign(shape.h) }
			case 1:
				return { x: 0, y: shape.h === 0 ? Math.abs(fallback.y || 1) : Math.sign(shape.h) }
			case 2:
				return { x: shape.w === 0 ? -Math.abs(fallback.x || 1) : -Math.sign(shape.w), y: 0 }
			case 3:
				return { x: shape.w === 0 ? Math.abs(fallback.x || 1) : Math.sign(shape.w), y: 0 }
		}
	}
	return fallback
}

export function createConnectorGeometry(
	start: Point,
	end: Point,
	from?: CanvasShape,
	to?: CanvasShape,
	pins: AnchorPins = {},
): ConnectorGeometry {
	const distance = Math.hypot(end.x - start.x, end.y - start.y)
	if (distance <= EPSILON) return { start, controlStart: start, controlEnd: end, end }

	const startFallback = fallbackDirection(start, end)
	const endFallback = fallbackDirection(end, start)
	const startDirection = from
		? outwardDirection(from, start, pins.fromAnchor, startFallback)
		: startFallback
	const endDirection = to ? outwardDirection(to, end, pins.toAnchor, endFallback) : endFallback
	const minimumBend = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 14 : 18
	const bend = Math.max(minimumBend, distance / 2)

	return {
		start,
		controlStart: {
			x: start.x + startDirection.x * bend,
			y: start.y + startDirection.y * bend,
		},
		controlEnd: {
			x: end.x + endDirection.x * bend,
			y: end.y + endDirection.y * bend,
		},
		end,
	}
}

export function getConnectorGeometry(
	shape: Connector,
	from: CanvasShape,
	to: CanvasShape,
): ConnectorGeometry {
	const { start, end } = getConnectorAnchors(from, to, shape)
	return createConnectorGeometry(start, end, from, to, shape)
}

export function createConnectorVisualGeometry(
	geometry: ConnectorGeometry,
	from?: CanvasShape,
	to?: CanvasShape,
	pins: AnchorPins = {},
): ConnectorVisualGeometry {
	const distance = Math.hypot(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y)
	const startFallback = fallbackDirection(geometry.start, geometry.end)
	const endFallback = fallbackDirection(geometry.end, geometry.start)
	const startDirection = from
		? outwardDirection(from, geometry.start, pins.fromAnchor, startFallback)
		: startFallback
	const endDirection = to
		? outwardDirection(to, geometry.end, pins.toAnchor, endFallback)
		: endFallback
	const showArrow = distance >= MIN_ARROW_DISTANCE
	const gap = showArrow ? Math.min(ENDPOINT_GAP, distance / 4) : 0
	const start = from
		? {
				x: geometry.start.x + startDirection.x * gap,
				y: geometry.start.y + startDirection.y * gap,
			}
		: geometry.start
	const arrowTip = to
		? {
				x: geometry.end.x + endDirection.x * gap,
				y: geometry.end.y + endDirection.y * gap,
			}
		: geometry.end
	const dx = arrowTip.x - start.x
	const dy = arrowTip.y - start.y
	const horizontal = Math.abs(dx) >= Math.abs(dy)
	const bend = Math.max(horizontal ? 14 : 18, (horizontal ? Math.abs(dx) : Math.abs(dy)) / 2)
	const end = showArrow
		? {
				x: arrowTip.x + endDirection.x * ARROW_LENGTH,
				y: arrowTip.y + endDirection.y * ARROW_LENGTH,
			}
		: arrowTip

	return {
		start,
		controlStart: {
			x: start.x + startDirection.x * bend,
			y: start.y + startDirection.y * bend,
		},
		controlEnd: {
			x: arrowTip.x + endDirection.x * bend,
			y: arrowTip.y + endDirection.y * bend,
		},
		end,
		arrowTip,
		showArrow,
	}
}

export function getConnectorVisualGeometry(
	shape: Connector,
	from: CanvasShape,
	to: CanvasShape,
): ConnectorVisualGeometry {
	return createConnectorVisualGeometry(getConnectorGeometry(shape, from, to), from, to, shape)
}

export function connectorPath({ start, controlStart, controlEnd, end }: ConnectorGeometry): string {
	return `M${start.x} ${start.y}C${controlStart.x} ${controlStart.y} ${controlEnd.x} ${controlEnd.y} ${end.x} ${end.y}`
}

export function connectorHitPath(geometry: ConnectorVisualGeometry): string {
	const path = connectorPath(geometry)
	return geometry.showArrow ? `${path}L${geometry.arrowTip.x} ${geometry.arrowTip.y}` : path
}

function isFinitePoint(point: Point): boolean {
	return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function cubicValue(
	start: number,
	controlStart: number,
	controlEnd: number,
	end: number,
	t: number,
) {
	const inverse = 1 - t
	const first = inverse * start + t * controlStart
	const second = inverse * controlStart + t * controlEnd
	const third = inverse * controlEnd + t * end
	const fourth = inverse * first + t * second
	const fifth = inverse * second + t * third
	return inverse * fourth + t * fifth
}

function cubicExtrema(start: number, controlStart: number, controlEnd: number, end: number) {
	const values = [start, end]
	const scale = Math.max(
		Math.abs(start),
		Math.abs(controlStart),
		Math.abs(controlEnd),
		Math.abs(end),
	)
	if (scale === 0) return values
	const p0 = start / scale
	const p1 = controlStart / scale
	const p2 = controlEnd / scale
	const p3 = end / scale
	const d0 = p1 - p0
	const d1 = p2 - p1
	const d2 = p3 - p2
	const a = d0 - 2 * d1 + d2
	const b = 2 * (d1 - d0)
	const c = d0
	const roots: number[] = []

	if (a === 0) {
		if (b !== 0) roots.push(-c / b)
	} else {
		const discriminant = b * b - 4 * a * c
		if (discriminant >= 0) {
			const squareRoot = Math.sqrt(discriminant)
			const q = -0.5 * (b + (b < 0 ? -squareRoot : squareRoot))
			if (q === 0) roots.push(-b / (2 * a))
			else roots.push(q / a, c / q)
		}
	}

	for (const root of roots) {
		if (Number.isFinite(root) && root > 0 && root < 1) {
			values.push(cubicValue(start, controlStart, controlEnd, end, root))
		}
	}
	return values
}

export function connectorVisualBounds(geometry: ConnectorVisualGeometry): ConnectorBounds | null {
	if (
		![
			geometry.start,
			geometry.controlStart,
			geometry.controlEnd,
			geometry.end,
			geometry.arrowTip,
		].every(isFinitePoint)
	)
		return null

	const xValues = cubicExtrema(
		geometry.start.x,
		geometry.controlStart.x,
		geometry.controlEnd.x,
		geometry.end.x,
	)
	const yValues = cubicExtrema(
		geometry.start.y,
		geometry.controlStart.y,
		geometry.controlEnd.y,
		geometry.end.y,
	)
	let left = Math.min(...xValues)
	let right = Math.max(...xValues)
	let top = Math.min(...yValues)
	let bottom = Math.max(...yValues)

	if (geometry.showArrow) {
		const angle = Math.atan2(
			geometry.arrowTip.y - geometry.end.y,
			geometry.arrowTip.x - geometry.end.x,
		)
		const cos = Math.cos(angle)
		const sin = Math.sin(angle)
		const strokePadding = 2.5 / 2
		for (const [x, y] of [
			[0, 0],
			[-10, -5.5],
			[-10, 5.5],
		]) {
			const arrowX = geometry.arrowTip.x + x * cos - y * sin
			const arrowY = geometry.arrowTip.y + x * sin + y * cos
			left = Math.min(left, arrowX - strokePadding)
			right = Math.max(right, arrowX + strokePadding)
			top = Math.min(top, arrowY - strokePadding)
			bottom = Math.max(bottom, arrowY + strokePadding)
		}
	}

	return [left, right, top, bottom].every(Number.isFinite) ? { left, right, top, bottom } : null
}

export function getConnectorVisualBounds(
	shape: Connector,
	from: CanvasShape,
	to: CanvasShape,
): ConnectorBounds | null {
	try {
		return connectorVisualBounds(getConnectorVisualGeometry(shape, from, to))
	} catch (error) {
		if (error instanceof RangeError) return null
		throw error
	}
}

export function getConnectorPath(shape: Connector, from: CanvasShape, to: CanvasShape): string {
	return connectorPath(getConnectorGeometry(shape, from, to))
}
