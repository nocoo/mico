import type { Board, Operation, Shape } from '../../shared/types.ts'

export const HISTORY_LIMIT = 20
export type HistoryDirection = 'undo' | 'redo'
export class HistoryConflict extends Error {}

interface HistoryEntry {
	before: Map<string, Shape>
	after: Map<string, Shape>
	beforeOrder: string[]
	afterOrder: string[]
}

function equal(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
	const left = a as Record<string, unknown>
	const right = b as Record<string, unknown>
	const keys = Object.keys(left)
	return (
		keys.length === Object.keys(right).length && keys.every((key) => equal(left[key], right[key]))
	)
}

function references(shape: Shape): string[] {
	if (shape.type === 'connector') return [shape.from, shape.to]
	return [shape.frameId, shape.backgroundImageId].filter((id): id is string => Boolean(id))
}

export class CanvasHistory {
	private past: HistoryEntry[] = []
	private future: HistoryEntry[] = []

	get canUndo(): boolean {
		return this.past.length > 0
	}

	get canRedo(): boolean {
		return this.future.length > 0
	}

	record(before: Board, after: Board): void {
		const previous = new Map(before.shapes.map((shape) => [shape.id, shape]))
		const next = new Map(after.shapes.map((shape) => [shape.id, shape]))
		const changed = new Set(
			[...previous.keys(), ...next.keys()].filter((id) => !equal(previous.get(id), next.get(id))),
		)
		if (changed.size === 0) return
		this.past.push({
			before: new Map(
				before.shapes
					.filter((shape) => changed.has(shape.id))
					.map((shape) => [shape.id, structuredClone(shape)]),
			),
			after: new Map(
				after.shapes
					.filter((shape) => changed.has(shape.id))
					.map((shape) => [shape.id, structuredClone(shape)]),
			),
			beforeOrder: before.shapes.map((shape) => shape.id),
			afterOrder: after.shapes.map((shape) => shape.id),
		})
		if (this.past.length > HISTORY_LIMIT) this.past.shift()
		this.future = []
	}

	plan(board: Board, direction: HistoryDirection): Operation[] | null {
		const entry = (direction === 'undo' ? this.past : this.future).at(-1)
		if (!entry) return null
		const expected = direction === 'undo' ? entry.after : entry.before
		const target = direction === 'undo' ? entry.before : entry.after
		const order = direction === 'undo' ? entry.beforeOrder : entry.afterOrder
		const ids = new Set([...expected.keys(), ...target.keys()])
		const current = new Map(board.shapes.map((shape) => [shape.id, shape]))
		for (const id of ids) {
			if (!equal(current.get(id), expected.get(id))) {
				throw new HistoryConflict(`Cannot ${direction}: an affected object was changed elsewhere`)
			}
		}
		const removed = new Set([...expected.keys()].filter((id) => !target.has(id)))
		for (const shape of board.shapes) {
			if (!ids.has(shape.id) && references(shape).some((id) => removed.has(id))) {
				throw new HistoryConflict(`Cannot ${direction}: another object now depends on this edit`)
			}
		}

		const result = board.shapes
			.filter((shape) => !removed.has(shape.id))
			.map((shape) => target.get(shape.id) ?? shape)
		for (let index = 0; index < order.length; index++) {
			const id = order[index]
			const shape = target.get(id)
			if (!shape || current.has(id)) continue
			const next = order
				.slice(index + 1)
				.find((candidate) => result.some((item) => item.id === candidate))
			const previous = order
				.slice(0, index)
				.reverse()
				.find((candidate) => result.some((item) => item.id === candidate))
			const position = next
				? result.findIndex((item) => item.id === next)
				: previous
					? result.findIndex((item) => item.id === previous) + 1
					: Math.min(index, result.length)
			result.splice(position, 0, shape)
		}
		const resultIds = new Set(result.map((shape) => shape.id))
		if (result.some((shape) => references(shape).some((id) => !resultIds.has(id)))) {
			throw new HistoryConflict(`Cannot ${direction}: a required object no longer exists`)
		}
		return [
			...board.shapes
				.filter((shape) => removed.has(shape.id))
				.map((shape): Operation => ({ type: 'delete', id: shape.id })),
			...result.flatMap((shape, index): Operation[] =>
				target.has(shape.id) ? [{ type: 'restore', shape, index }] : [],
			),
		]
	}

	matchesResult(board: Board, direction: HistoryDirection): boolean {
		const entry = (direction === 'undo' ? this.past : this.future).at(-1)
		if (!entry) return false
		const target = direction === 'undo' ? entry.before : entry.after
		const current = new Map(board.shapes.map((shape) => [shape.id, shape]))
		return [...new Set([...entry.before.keys(), ...entry.after.keys()])].every((id) =>
			equal(current.get(id), target.get(id)),
		)
	}

	complete(direction: HistoryDirection): void {
		const source = direction === 'undo' ? this.past : this.future
		const target = direction === 'undo' ? this.future : this.past
		const entry = source.pop()
		if (entry) target.push(entry)
	}
}
