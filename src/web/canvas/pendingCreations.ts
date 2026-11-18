import type { Board, CanvasShape } from '../../shared/types.ts'

export type PendingCreationState = 'pending' | 'uncertain'

export interface PendingCreation {
	readonly shape: CanvasShape
	readonly state: PendingCreationState
}

export type PendingCreationEntries = Map<string, PendingCreation>

export function beginPendingCreation(
	current: PendingCreationEntries,
	shape: CanvasShape,
): PendingCreationEntries {
	const next = new Map(current)
	next.set(shape.id, { shape, state: 'pending' })
	return next
}

export function markConfirmed(current: PendingCreationEntries, id: string): PendingCreationEntries {
	if (!current.has(id)) return current
	const next = new Map(current)
	next.delete(id)
	return next
}

export function markUncertain(current: PendingCreationEntries, id: string): PendingCreationEntries {
	const entry = current.get(id)
	if (!entry || entry.state === 'uncertain') return current
	const next = new Map(current)
	next.set(id, { ...entry, state: 'uncertain' })
	return next
}

export function reconcilePendingCreations(
	current: PendingCreationEntries,
	board: Board,
): PendingCreationEntries {
	const present = new Set(board.shapes.map((shape) => shape.id))
	let next: PendingCreationEntries | null = null
	for (const [id] of current) {
		if (!present.has(id)) continue
		if (!next) next = new Map(current)
		next.delete(id)
	}
	return next ?? current
}

export function clearPendingCreations(): PendingCreationEntries {
	return new Map()
}
