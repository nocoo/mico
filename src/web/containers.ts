import type { CanvasShape, Shape } from '../shared/types.ts'
import type { Rect } from './selection.ts'

function normalize(rect: Rect): Rect {
	return {
		x: Math.min(rect.x, rect.x + rect.w),
		y: Math.min(rect.y, rect.y + rect.h),
		w: Math.abs(rect.w),
		h: Math.abs(rect.h),
	}
}

export function frameContains(frame: CanvasShape, rect: Rect): boolean {
	const inner = normalize(rect)
	const left = Math.min(frame.x, frame.x + frame.w)
	const top = Math.min(frame.y, frame.y + frame.h)
	const right = Math.max(frame.x, frame.x + frame.w)
	const bottom = Math.max(frame.y, frame.y + frame.h)
	return (
		inner.x >= left && inner.y >= top && inner.x + inner.w <= right && inner.y + inner.h <= bottom
	)
}

export function frameIntersects(frame: CanvasShape, rect: Rect): boolean {
	const inner = normalize(rect)
	const left = Math.min(frame.x, frame.x + frame.w)
	const top = Math.min(frame.y, frame.y + frame.h)
	const right = Math.max(frame.x, frame.x + frame.w)
	const bottom = Math.max(frame.y, frame.y + frame.h)
	return (
		inner.x <= right && inner.x + inner.w >= left && inner.y <= bottom && inner.y + inner.h >= top
	)
}

export function frameFor(shapes: Shape[], rect: Rect, excludedId?: string): CanvasShape | null {
	let chosen: CanvasShape | null = null
	for (const shape of shapes) {
		if (shape.type !== 'frame') continue
		if (shape.id === excludedId) continue
		if (!frameContains(shape, rect)) continue
		if (!chosen || Math.abs(shape.w * shape.h) < Math.abs(chosen.w * chosen.h)) chosen = shape
	}
	return chosen
}

export function membershipFor(shapes: Shape[], rect: Rect, excludedId?: string): string | null {
	return frameFor(shapes, rect, excludedId)?.id ?? null
}

export function membershipAfterMove(
	shapes: Shape[],
	currentFrameId: string | undefined,
	rect: Rect,
	excludedId: string,
): string | null {
	if (currentFrameId) {
		const current = shapes.find((shape) => shape.id === currentFrameId && shape.type === 'frame')
		if (current?.type === 'frame' && frameIntersects(current, rect)) return currentFrameId
	}
	return membershipFor(shapes, rect, excludedId)
}
