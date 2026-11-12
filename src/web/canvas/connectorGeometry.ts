import type { CanvasShape, Connector } from '../../shared/types.ts'
import { type AnchorPins, getAnchors, getConnectorAnchors, type Point } from '../anchors.ts'

export interface ConnectorGeometry {
	start: Point
	controlStart: Point
	controlEnd: Point
	end: Point
}

const EPSILON = 1e-9

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

export function connectorPath({ start, controlStart, controlEnd, end }: ConnectorGeometry): string {
	return `M${start.x} ${start.y}C${controlStart.x} ${controlStart.y} ${controlEnd.x} ${controlEnd.y} ${end.x} ${end.y}`
}

export function getConnectorPath(shape: Connector, from: CanvasShape, to: CanvasShape): string {
	return connectorPath(getConnectorGeometry(shape, from, to))
}
