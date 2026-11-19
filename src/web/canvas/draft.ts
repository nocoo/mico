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

export function finalizeCurrentDraft(draft: CanvasShape): CanvasShape | null {
	if (Math.abs(draft.w) < MIN_SIZE && Math.abs(draft.h) < MIN_SIZE) return null
	if (draft.type === 'line') return draft
	return { ...draft, w: Math.max(MIN_SIZE, draft.w), h: Math.max(MIN_SIZE, draft.h) }
}

export function finalizeDraft(
	draft: CanvasShape,
	start: Point,
	pointer: Point,
): CanvasShape | null {
	return finalizeCurrentDraft(updateDraft(draft, start, pointer))
}
