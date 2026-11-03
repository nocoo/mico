import type { Board, CanvasShape, Connector } from '../shared/types.ts'

export function canRebaseMove(board: Board, original: CanvasShape): boolean {
	const current = board.shapes.find((shape) => shape.id === original.id)
	return (
		current !== undefined &&
		current.type !== 'connector' &&
		current.type === original.type &&
		current.x === original.x &&
		current.y === original.y &&
		current.w === original.w &&
		current.h === original.h &&
		current.color === original.color &&
		current.text === original.text
	)
}

export function canRebaseConnector(board: Board, original: Connector): boolean {
	const current = board.shapes.find((shape) => shape.id === original.id)
	return (
		current !== undefined &&
		current.type === 'connector' &&
		current.from === original.from &&
		current.to === original.to &&
		current.fromAnchor === original.fromAnchor &&
		current.toAnchor === original.toAnchor &&
		current.color === original.color
	)
}
