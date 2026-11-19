import type { CanvasShape, Point } from '../../shared/types.ts'

export type DraftKind = 'rectangle' | 'ellipse' | 'line'

const MIN_SIZE = 8

export function beginDraft(input: {
	id: string
	kind: DraftKind
	start: Point
	color: string
}): CanvasShape {
	return {
		id: input.id,
		type: input.kind,
		x: input.start.x,
		y: input.start.y,
		w: 0,
		h: 0,
		color: input.color,
	}
}

export function updateDraft(draft: CanvasShape, start: Point, pointer: Point): CanvasShape {
	if (draft.type === 'line') {
		return { ...draft, w: pointer.x - start.x, h: pointer.y - start.y }
	}
	return {
		...draft,
		x: Math.min(start.x, pointer.x),
		y: Math.min(start.y, pointer.y),
		w: Math.abs(pointer.x - start.x),
		h: Math.abs(pointer.y - start.y),
	}
}

export function finalizeDraft(
	draft: CanvasShape,
	start: Point,
	pointer: Point,
): CanvasShape | null {
	const finalized = updateDraft(draft, start, pointer)
	if (Math.abs(finalized.w) < MIN_SIZE && Math.abs(finalized.h) < MIN_SIZE) return null
	if (finalized.type === 'line') return finalized
	return { ...finalized, w: Math.max(MIN_SIZE, finalized.w), h: Math.max(MIN_SIZE, finalized.h) }
}
