export type ShapeType = 'rectangle' | 'ellipse' | 'text' | 'line'

export interface Point {
	x: number
	y: number
}

export const ANCHOR_COUNTS: Record<ShapeType, number> = {
	rectangle: 12,
	ellipse: 12,
	text: 12,
	line: 5,
}

export interface CanvasShape {
	id: string
	type: ShapeType
	x: number
	y: number
	w: number
	h: number
	color: string
	text?: string
}

export interface Connector {
	id: string
	type: 'connector'
	from: string
	to: string
	color: string
	fromAnchor?: number
	toAnchor?: number
}

export type Shape = CanvasShape | Connector

export interface Board {
	revision: number
	shapes: Shape[]
}

export type Operation =
	| { type: 'create'; shape: Shape }
	| {
			type: 'update'
			id: string
			patch: {
				x?: number
				y?: number
				w?: number
				h?: number
				color?: string
				text?: string
				from?: string
				to?: string
				fromAnchor?: number
				toAnchor?: number
			}
	  }
	| { type: 'delete'; id: string }

export interface OperationRequest {
	operations: Operation[]
	expectedRevision?: number
}
