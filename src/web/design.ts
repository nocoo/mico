export const CONTROL_SIZE = 40
export const ICON_SIZE = 20
export const TEXT_SIZE = 14
export type DrawTool = 'rectangle' | 'ellipse' | 'text' | 'line' | 'path'
export type Tool = 'select' | 'hand' | 'connector' | DrawTool

export const SHAPE_COLORS = [
	{ value: '#5b5fc7', label: 'Indigo' },
	{ value: '#0f6cbd', label: 'Blue' },
	{ value: '#107c10', label: 'Green' },
	{ value: '#b45309', label: 'Amber' },
	{ value: '#c42b1c', label: 'Red' },
	{ value: '#242424', label: 'Graphite' },
] as const
