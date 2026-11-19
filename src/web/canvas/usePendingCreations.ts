import { useCallback, useRef, useState } from 'react'
import type { Board, CanvasShape } from '../../shared/types.ts'
import {
	beginPendingCreation,
	clearPendingCreations,
	markConfirmed,
	markUncertain,
	type PendingCreationEntries,
	reconcilePendingCreations,
} from './pendingCreations.ts'

export interface PendingCreationsViewModel {
	readonly entries: PendingCreationEntries
	has(id: string): boolean
	size(): number
	begin(shape: CanvasShape): void
	confirm(id: string): void
	uncertain(id: string): void
	reconcile(board: Board): void
	reset(): void
}

export function usePendingCreations(): PendingCreationsViewModel {
	const [entries, setEntries] = useState<PendingCreationEntries>(() => new Map())
	const entriesRef = useRef<PendingCreationEntries>(new Map())

	const apply = useCallback((next: PendingCreationEntries) => {
		entriesRef.current = next
		setEntries(next)
	}, [])

	const has = useCallback((id: string) => entriesRef.current.has(id), [])
	const size = useCallback(() => entriesRef.current.size, [])
	const begin = useCallback(
		(shape: CanvasShape) => {
			apply(beginPendingCreation(entriesRef.current, shape))
		},
		[apply],
	)
	const confirm = useCallback(
		(id: string) => {
			apply(markConfirmed(entriesRef.current, id))
		},
		[apply],
	)
	const uncertain = useCallback(
		(id: string) => {
			apply(markUncertain(entriesRef.current, id))
		},
		[apply],
	)
	const reconcile = useCallback(
		(board: Board) => {
			apply(reconcilePendingCreations(entriesRef.current, board))
		},
		[apply],
	)
	const reset = useCallback(() => {
		apply(clearPendingCreations())
	}, [apply])

	return {
		entries,
		has,
		size,
		begin,
		confirm,
		uncertain,
		reconcile,
		reset,
	}
}
