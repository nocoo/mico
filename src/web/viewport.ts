import type { Shape } from '../shared/types.ts'

export function fitViewport(shapes: Shape[], width: number, height: number, bottomInset: number) {
	const objects = shapes.filter((shape) => shape.type !== 'connector')
	if (objects.length === 0) return { x: 0, y: 0, zoom: 1 }

	const viewportWidth = Number.isFinite(width) ? Math.max(1, width) : 1
	const viewportHeight = Number.isFinite(height) ? Math.max(1, height) : 1
	const safeBottomInset = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0
	const leftMargin = 40
	const topMargin = 80
	const rightMargin = 40
	const availableWidth = Math.max(1, viewportWidth - leftMargin - rightMargin)
	const availableBottom = Math.max(topMargin, viewportHeight - safeBottomInset)
	const availableHeight = Math.max(1, availableBottom - topMargin)

	const left = Math.min(...objects.map((shape) => Math.min(shape.x, shape.x + shape.w)))
	const right = Math.max(...objects.map((shape) => Math.max(shape.x, shape.x + shape.w)))
	const top = Math.min(...objects.map((shape) => Math.min(shape.y, shape.y + shape.h)))
	const bottom = Math.max(...objects.map((shape) => Math.max(shape.y, shape.y + shape.h)))
	const zoom = Math.min(
		1,
		availableWidth / Math.max(1, right - left),
		availableHeight / Math.max(1, bottom - top),
	)
	const centerX = viewportWidth / 2
	const centerY = (topMargin + availableBottom) / 2
	return {
		x: centerX - ((left + right) / 2) * zoom,
		y: centerY - ((top + bottom) / 2) * zoom,
		zoom,
	}
}
