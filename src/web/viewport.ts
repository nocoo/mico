import type { Shape } from '../shared/types.ts'
import { getConnectorAnchors } from './anchors.ts'
import { getConnectorRoute } from './routing.ts'

export function fitViewport(
	shapes: Shape[],
	width: number,
	height: number,
): { x: number; y: number; zoom: number } | null {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null
	}

	let minX = Number.POSITIVE_INFINITY
	let minY = Number.POSITIVE_INFINITY
	let maxX = Number.NEGATIVE_INFINITY
	let maxY = Number.NEGATIVE_INFINITY

	for (const shape of shapes) {
		if (shape.type === 'connector') {
			continue
		}
		if (![shape.x, shape.y, shape.w, shape.h].every(Number.isFinite)) {
			continue
		}

		const endX = shape.x + shape.w
		const endY = shape.y + shape.h
		if (!Number.isFinite(endX) || !Number.isFinite(endY)) {
			continue
		}

		const shapeMinX = Math.min(shape.x, endX)
		const shapeMaxX = Math.max(shape.x, endX)
		const shapeMinY = Math.min(shape.y, endY)
		const shapeMaxY = Math.max(shape.y, endY)

		minX = Math.min(minX, shapeMinX)
		maxX = Math.max(maxX, shapeMaxX)
		minY = Math.min(minY, shapeMinY)
		maxY = Math.max(maxY, shapeMaxY)
	}

	if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
		return null
	}

	const byId = new Map(shapes.map((shape) => [shape.id, shape]))
	for (const shape of shapes) {
		if (
			shape.type !== 'connector' ||
			(shape.fromAnchor === undefined && shape.toAnchor === undefined)
		)
			continue
		const from = byId.get(shape.from)
		const to = byId.get(shape.to)
		if (!from || !to || from.type === 'connector' || to.type === 'connector') continue
		if (![from.x, from.y, from.w, from.h, to.x, to.y, to.w, to.h].every(Number.isFinite)) continue
		const { start, end } = getConnectorAnchors(from, to, shape.fromAnchor, shape.toAnchor)
		for (const point of getConnectorRoute(from, to, start, end, shape.fromAnchor, shape.toAnchor)) {
			if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
			minX = Math.min(minX, point.x)
			maxX = Math.max(maxX, point.x)
			minY = Math.min(minY, point.y)
			maxY = Math.max(maxY, point.y)
		}
	}

	const boundsWidth = maxX - minX
	const boundsHeight = maxY - minY
	if (!Number.isFinite(boundsWidth) || !Number.isFinite(boundsHeight)) {
		return null
	}

	const availableWidth = width * 0.8
	const availableHeight = height * 0.8
	if (availableWidth <= 0 || availableHeight <= 0) {
		return null
	}

	let zoom = 1.5
	if (boundsWidth > 0) {
		const widthZoom = availableWidth / boundsWidth
		if (widthZoom > 0) {
			zoom = Math.min(zoom, widthZoom)
		}
	}
	if (boundsHeight > 0) {
		const heightZoom = availableHeight / boundsHeight
		if (heightZoom > 0) {
			zoom = Math.min(zoom, heightZoom)
		}
	}
	if (!Number.isFinite(zoom) || zoom <= 0) {
		return null
	}

	const centerX = minX / 2 + maxX / 2
	const centerY = minY / 2 + maxY / 2
	const x = width / 2 - centerX * zoom
	const y = height / 2 - centerY * zoom
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return null
	}

	return { x, y, zoom }
}
