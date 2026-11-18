import type { Board, CanvasSummary, ServerEvent } from '../shared/types.ts'

export type BoardServerEvent = Extract<ServerEvent, { type: 'board' }>

export interface BoardEventSource {
	readonly canvasId: string
	readonly canvas: CanvasSummary
	readonly board: Board
}

export function boardEvent(source: BoardEventSource): BoardServerEvent {
	return {
		type: 'board',
		canvasId: source.canvasId,
		canvas: source.canvas,
		board: source.board,
	}
}
