import type { Board, CanvasShape } from '../shared/types.ts'

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
		current.text === original.text &&
		current.frameId === original.frameId
	)
}

export function canRebaseMoveGroup(board: Board, originals: CanvasShape[]): boolean {
	if (!originals.every((shape) => canRebaseMove(board, shape))) return false
	for (const shape of originals) {
		if (shape.type !== 'frame') continue
		const current = board.shapes
			.filter((candidate) => candidate.type !== 'connector' && candidate.frameId === shape.id)
			.map((candidate) => candidate.id)
			.sort()
		const expected = originals
			.filter((candidate) => candidate.frameId === shape.id)
			.map((candidate) => candidate.id)
			.sort()
		if (current.join('\n') !== expected.join('\n')) return false
	}
	return true
}
