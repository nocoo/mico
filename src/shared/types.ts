export type ShapeType =
	| 'rectangle'
	| 'ellipse'
	| 'text'
	| 'line'
	| 'path'
	| 'frame'
	| 'note'
	| 'widget'
export type FontFamily = 'sans' | 'serif' | 'hand' | 'mono'
export type WidgetKind = 'todo' | 'kanban' | 'table' | 'timeline'
export interface WidgetItem {
	id: string
	title: string
	done?: boolean
	status?: string
	start?: number
	end?: number
}
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
	widget: 12,
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
	font?: FontFamily
	fontSize?: number
	fontWeight?: number
	widget?: WidgetKind
	widgetTitle?: string
	items?: WidgetItem[]
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
				font?: FontFamily
				fontSize?: number
				fontWeight?: number
				widget?: WidgetKind
				widgetTitle?: string
				items?: WidgetItem[]
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
