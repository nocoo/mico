import type { Board, Shape } from '../../shared/types.ts'

const ENTRY_TYPES = new Set<Shape['type']>(['note', 'rectangle', 'ellipse', 'text', 'connector'])

export function transitionEntryAnimations(
	previous: Board,
	next: Board,
	switching: boolean,
	current: ReadonlySet<string>,
	suppressed: ReadonlySet<string>,
): Set<string> {
	if (switching) return new Set()
	const nextIds = new Set(
		next.shapes.filter((shape) => ENTRY_TYPES.has(shape.type)).map(({ id }) => id),
	)
	const result = new Set([...current].filter((id) => nextIds.has(id)))
	const previousIds = new Set(previous.shapes.map(({ id }) => id))
	for (const shape of next.shapes) {
		if (!ENTRY_TYPES.has(shape.type) || previousIds.has(shape.id) || suppressed.has(shape.id))
			continue
		result.add(shape.id)
	}
	return result
}
