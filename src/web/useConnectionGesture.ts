import { useCallback, useRef, useState } from 'react'
import type { Board, CanvasShape, Connector, Operation, Point, Shape } from '../shared/types'
import { getAnchors, getConnectorAnchors } from './anchors'
import { canRebaseConnector, findSnapTarget, type SnapTarget } from './connections'
import { CANDY_LAYOUT } from './design'

export interface ConnectionDraft {
	pointerId: number
	token: symbol
	original: Connector | null
	endpoint: 'from' | 'to'
	fixed: SnapTarget
	origin: Point
	pointer: Point
	target: SnapTarget | null
	pending: boolean
	revision: number
}

type Commit = (
	operations: Operation[],
	expectedRevision?: number,
	canRebase?: (board: Board) => boolean,
) => Promise<boolean>

function node(shapes: Shape[], id: string): CanvasShape | undefined {
	const shape = shapes.find((item) => item.id === id)
	return shape?.type !== 'connector' ? shape : undefined
}

function snapFor(shape: CanvasShape, point: Point): SnapTarget {
	const anchors = getAnchors(shape)
	let anchorIndex = 0
	let nearest = Number.POSITIVE_INFINITY
	for (const [index, anchor] of anchors.entries()) {
		const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y)
		if (distance < nearest) {
			nearest = distance
			anchorIndex = index
		}
	}
	return { shapeId: shape.id, anchorIndex, point: anchors[anchorIndex] }
}

export function useConnectionGesture(board: Board, zoom: number, commit: Commit) {
	const [draft, setDraft] = useState<ConnectionDraft | null>(null)
	const draftRef = useRef<ConnectionDraft | null>(null)
	const update = useCallback((next: ConnectionDraft | null) => {
		draftRef.current = next
		setDraft(next)
	}, [])

	const cancel = useCallback(() => {
		if (!draftRef.current?.pending) update(null)
	}, [update])

	const begin = (source: CanvasShape, pointer: Point, pointerId: number) => {
		if (draftRef.current?.pending) return false
		update({
			pointerId,
			token: Symbol(),
			original: null,
			endpoint: 'to',
			fixed: snapFor(source, pointer),
			origin: pointer,
			pointer,
			target: null,
			pending: false,
			revision: board.revision,
		})
		return true
	}

	const reconnect = (
		original: Connector,
		endpoint: 'from' | 'to',
		pointer: Point,
		pointerId: number,
	) => {
		if (draftRef.current?.pending) return false
		const from = node(board.shapes, original.from)
		const to = node(board.shapes, original.to)
		if (!from || !to) return false
		const { start, end } = getConnectorAnchors(from, to, original)
		update({
			pointerId,
			token: Symbol(),
			original,
			endpoint,
			fixed: snapFor(endpoint === 'from' ? to : from, endpoint === 'from' ? end : start),
			origin: pointer,
			pointer,
			target: snapFor(endpoint === 'from' ? from : to, endpoint === 'from' ? start : end),
			pending: false,
			revision: board.revision,
		})
		return true
	}

	const move = (pointer: Point) => {
		const current = draftRef.current
		if (!current || current.pending) return
		const fixed = node(board.shapes, current.fixed.shapeId)
		update({
			...current,
			pointer,
			target: fixed ? findSnapTarget(board.shapes, pointer, fixed, zoom) : null,
		})
	}

	const finish = (pointer: Point, pointerId: number) => {
		const current = draftRef.current
		if (!current || current.pending || current.pointerId !== pointerId) return
		const fixedShape = node(board.shapes, current.fixed.shapeId)
		const target = fixedShape ? findSnapTarget(board.shapes, pointer, fixedShape, zoom) : null
		if (
			!target ||
			(current.original &&
				Math.hypot(pointer.x - current.origin.x, pointer.y - current.origin.y) * zoom < 3)
		) {
			update(null)
			return
		}
		const from = current.endpoint === 'from' ? target : current.fixed
		const to = current.endpoint === 'from' ? current.fixed : target
		const endpoints = {
			from: from.shapeId,
			to: to.shapeId,
			fromAnchor: from.anchorIndex,
			toAnchor: to.anchorIndex,
		}
		const original = current.original
		const operation: Operation = original
			? { type: 'update', id: original.id, patch: endpoints }
			: {
					type: 'create',
					shape: {
						id: crypto.randomUUID(),
						type: 'connector',
						color: CANDY_LAYOUT.inkSecondary,
						...endpoints,
					},
				}
		update({ ...current, target, pointer, pending: true })
		void commit([operation], current.revision, (latest) => {
			return (
				!!node(latest.shapes, from.shapeId) &&
				!!node(latest.shapes, to.shapeId) &&
				(!original || canRebaseConnector(latest, original))
			)
		}).then(() => {
			if (draftRef.current?.token === current.token) update(null)
		})
	}

	const fixedShape = draft ? node(board.shapes, draft.fixed.shapeId) : undefined
	const targetShape = draft?.target ? node(board.shapes, draft.target.shapeId) : undefined
	const fixedPoint = fixedShape && draft ? getAnchors(fixedShape)[draft.fixed.anchorIndex] : null
	const targetPoint =
		draft?.target && targetShape ? getAnchors(targetShape)[draft.target.anchorIndex] : null
	const preview =
		draft && fixedPoint
			? {
					start: draft.endpoint === 'from' ? (targetPoint ?? draft.pointer) : fixedPoint,
					end: draft.endpoint === 'from' ? fixedPoint : (targetPoint ?? draft.pointer),
				}
			: null

	return { draft, preview, fixedShape, targetShape, begin, reconnect, move, finish, cancel }
}
