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

export function getConnectorPath(shape: Connector, from: CanvasShape, to: CanvasShape): string {
	return connectorPath(getConnectorGeometry(shape, from, to))
}
