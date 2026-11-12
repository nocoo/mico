import type { Board, Shape } from '../../shared/types.ts'

const ENTRY_TYPES = new Set<Shape['type']>(['note', 'rectangle', 'ellipse', 'text', 'connector'])

export type EntrySuppressionRegistry = Map<string, Map<string, symbol>>

export function suppressEntryAnimation(
	registry: EntrySuppressionRegistry,
	canvasId: string,
	id: string,
	token: symbol,
): void {
	let ids = registry.get(canvasId)
	if (!ids) {
		ids = new Map()
		registry.set(canvasId, ids)
	}
	ids.set(id, token)
}

export function clearEntrySuppression(
	registry: EntrySuppressionRegistry,
	canvasId: string,
	id: string,
	token: symbol,
): void {
	const ids = registry.get(canvasId)
	if (ids?.get(id) !== token) return
	ids.delete(id)
	if (ids.size === 0) registry.delete(canvasId)
}

export function suppressedEntryIds(
	registry: EntrySuppressionRegistry,
	canvasId: string,
): ReadonlySet<string> {
	return new Set(registry.get(canvasId)?.keys())
}

export function clearObservedEntrySuppressions(
	registry: EntrySuppressionRegistry,
	canvasId: string,
	shapes: readonly Shape[],
): void {
	const ids = registry.get(canvasId)
	if (!ids) return
	const observed = new Set(shapes.map(({ id }) => id))
	for (const id of ids.keys()) if (observed.has(id)) ids.delete(id)
	if (ids.size === 0) registry.delete(canvasId)
}

export function entryAnimationCompleted(kind: 'pop' | 'draw', animationName: string): boolean {
	return animationName === (kind === 'draw' ? 'canvas-edge-fade-in' : 'canvas-entry-pop')
}

export function clearReducedMotionEntries(current: Set<string>, shapes: readonly Shape[]): boolean {
	let changed = false
	const notes = new Set(shapes.filter(({ type }) => type === 'note').map(({ id }) => id))
	for (const id of current) {
		if (notes.has(id)) continue
		current.delete(id)
		changed = true
	}
	return changed
}

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
