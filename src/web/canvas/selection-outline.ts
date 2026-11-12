import type { CanvasShape } from '../../shared/types.ts'

export function selectionOutlineGeometry(shape: CanvasShape, zoom: number) {
	if (!Number.isFinite(zoom) || zoom <= 0) {
		throw new RangeError('selection outline: zoom must be finite and positive')
	}
	for (const value of [shape.x, shape.y, shape.w, shape.h]) {
		if (!Number.isFinite(value)) throw new RangeError('selection outline: geometry must be finite')
	}
	const radius =
		shape.type === 'ellipse'
			? '50%'
			: shape.type === 'note'
				? 22
				: shape.type === 'rectangle' && shape.text
					? 20
					: shape.type === 'rectangle'
						? 22
						: shape.type === 'html'
							? 32
							: shape.type === 'frame'
								? 18
								: shape.type === 'image'
									? 10
									: shape.type === 'text'
										? 0
										: 4
	return {
		x: Math.min(shape.x, shape.x + shape.w),
		y: Math.min(shape.y, shape.y + shape.h),
		width: Math.max(Math.abs(shape.w), 1 / zoom),
		height: Math.max(Math.abs(shape.h), 1 / zoom),
		radius,
		outlineWidth: 2.5 / zoom,
		outlineOffset: 5 / zoom,
	}
}
