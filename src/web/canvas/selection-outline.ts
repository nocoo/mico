import type { CanvasShape } from '../../shared/types.ts'

export type SelectionOutlineGeometry =
	| {
			kind: 'ellipse'
			rx: number
			ry: number
			cx: number
			cy: number
	  }
	| {
			kind: 'rect'
			x: number
			y: number
			width: number
			height: number
			rx: number
	  }

function requireFinite(value: number, name: string): void {
	if (!Number.isFinite(value)) throw new RangeError(`selection outline: ${name} must be finite`)
}

function screenRadius(shape: CanvasShape, zoom: number): number {
	const radius =
		shape.type === 'ellipse'
			? 0
			: shape.type === 'note'
				? 22
				: shape.type === 'rectangle' && (shape.text?.length ?? 0) > 0
					? 20
					: shape.type === 'frame' || shape.type === 'html' || shape.type === 'image'
						? 10
						: shape.type === 'text'
							? 6
							: shape.type === 'line' || shape.type === 'path'
								? 4
								: 22
	return radius / zoom
}

export function selectionOutlineGeometry(
	shape: CanvasShape,
	zoom: number,
): SelectionOutlineGeometry {
	requireFinite(zoom, 'zoom')
	if (zoom <= 0) throw new RangeError('selection outline: zoom must be positive')
	for (const [name, value] of [
		['x', shape.x],
		['y', shape.y],
		['w', shape.w],
		['h', shape.h],
	] as const)
		requireFinite(value, name)

	const left = Math.min(shape.x, shape.x + shape.w)
	const top = Math.min(shape.y, shape.y + shape.h)
	const width = Math.abs(shape.w)
	const height = Math.abs(shape.h)
	const offset = 5 / zoom

	if (shape.type === 'ellipse') {
		return {
			kind: 'ellipse',
			cx: left + width / 2,
			cy: top + height / 2,
			rx: width / 2 + offset,
			ry: height / 2 + offset,
		}
	}

	return {
		kind: 'rect',
		x: left - offset,
		y: top - offset,
		width: width + offset * 2,
		height: height + offset * 2,
		rx: screenRadius(shape, zoom),
	}
}
