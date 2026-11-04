export type ShapeType =
	| 'rectangle'
	| 'ellipse'
	| 'text'
	| 'line'
	| 'path'
	| 'frame'
	| 'note'
	| 'html'
export type FontFamily = 'sans' | 'serif' | 'hand' | 'mono'
export type BrushStyle = 'pencil' | 'marker' | 'brush'

export interface Point {
	x: number
	y: number
}

export const ANCHOR_COUNTS: Record<ShapeType, number> = {
	rectangle: 12,
	ellipse: 12,
	text: 12,
	line: 5,
	path: 12,
	frame: 12,
	note: 12,
	html: 12,
}

export const MEMBER_TYPES = [
	'rectangle',
	'ellipse',
	'text',
	'line',
	'path',
	'note',
	'html',
] as const satisfies readonly ShapeType[]

export function isMemberType(type: ShapeType): boolean {
	return (MEMBER_TYPES as readonly ShapeType[]).includes(type)
}

export function connectionCompatible(a: ShapeType, b: ShapeType): boolean {
	return (a === 'frame') === (b === 'frame')
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
	points?: Point[]
	brush?: BrushStyle
	strokeWidth?: number
	frameId?: string
	title?: string
	html?: string
	font?: FontFamily
	fontSize?: number
	fontWeight?: number
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
				points?: Point[]
				brush?: BrushStyle
				strokeWidth?: number
				frameId?: string | null
				title?: string
				html?: string
				font?: FontFamily
				fontSize?: number
				fontWeight?: number
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
