import type { Shape } from '../shared/types.ts'

export function fitViewport(shapes: Shape[], width: number, height: number) {
	const objects = shapes.filter((shape) => shape.type !== 'connector')
	if (objects.length === 0) return { x: 0, y: 0, zoom: 1 }
	const left = Math.min(...objects.map((shape) => Math.min(shape.x, shape.x + shape.w)))
	const right = Math.max(...objects.map((shape) => Math.max(shape.x, shape.x + shape.w)))
	const top = Math.min(...objects.map((shape) => Math.min(shape.y, shape.y + shape.h)))
	const bottom = Math.max(...objects.map((shape) => Math.max(shape.y, shape.y + shape.h)))
	const zoom = Math.min(
		1,
		Math.max(1, width - 80) / Math.max(1, right - left),
		Math.max(1, height - 160) / Math.max(1, bottom - top),
	)
	return {
		x: width / 2 - ((left + right) / 2) * zoom,
		y: height / 2 - ((top + bottom) / 2) * zoom,
		zoom,
	}
}
