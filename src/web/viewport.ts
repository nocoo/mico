import type { CanvasShape, Shape } from '../shared/types.ts'
import { getConnectorVisualBounds } from './canvas/connectorGeometry.ts'

export interface ViewportInsets {
	right?: number
}

export function panelViewportInset(
	canvasWidth: number,
	reservedWidth: number,
	panelWidth: number,
	panelInset: number,
) {
	return panelWidth + panelInset * 2 >= canvasWidth ? 0 : reservedWidth
}

export function fitViewport(
	shapes: Shape[],
	width: number,
	height: number,
	insets: ViewportInsets = {},
) {
	const objects = new Map<string, CanvasShape>()
	let left = Number.POSITIVE_INFINITY
	let right = Number.NEGATIVE_INFINITY
	let top = Number.POSITIVE_INFINITY
	let bottom = Number.NEGATIVE_INFINITY

	for (const shape of shapes) {
		if (shape.type === 'connector') continue
		objects.set(shape.id, shape)
		const shapeLeft = Math.min(shape.x, shape.x + shape.w)
		const shapeRight = Math.max(shape.x, shape.x + shape.w)
		const shapeTop = Math.min(shape.y, shape.y + shape.h)
		const shapeBottom = Math.max(shape.y, shape.y + shape.h)
		if (![shapeLeft, shapeRight, shapeTop, shapeBottom].every(Number.isFinite)) continue
		left = Math.min(left, shapeLeft)
		right = Math.max(right, shapeRight)
		top = Math.min(top, shapeTop)
		bottom = Math.max(bottom, shapeBottom)
	}

	if (objects.size === 0 || ![left, right, top, bottom].every(Number.isFinite)) {
		return { x: 0, y: 0, zoom: 1 }
	}

	for (const shape of shapes) {
		if (shape.type !== 'connector') continue
		const from = objects.get(shape.from)
		const to = objects.get(shape.to)
		if (!from || !to) continue
		const bounds = getConnectorVisualBounds(shape, from, to)
		if (!bounds) continue
		left = Math.min(left, bounds.left)
		right = Math.max(right, bounds.right)
		top = Math.min(top, bounds.top)
		bottom = Math.max(bottom, bounds.bottom)
	}

	const availableWidth = Math.max(1, width - Math.max(0, insets.right ?? 0))
	const zoom = Math.min(
		1,
		Math.max(1, availableWidth - 80) / Math.max(1, right - left),
		Math.max(1, height - 160) / Math.max(1, bottom - top),
	)
	return {
		x: availableWidth / 2 - ((left + right) / 2) * zoom,
		y: height / 2 - ((top + bottom) / 2) * zoom,
		zoom,
	}
}
