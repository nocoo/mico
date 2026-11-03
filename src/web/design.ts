export const CONTROL_SIZE = 40
export const ICON_SIZE = 20
export const TEXT_SIZE = 14
export type DrawTool = 'rectangle' | 'ellipse' | 'text' | 'line' | 'path' | 'note' | 'widget'
export type Tool = 'select' | 'hand' | 'connector' | DrawTool

export const BRUSH_STYLES = [
	{ id: 'pencil', label: 'Pencil' },
	{ id: 'marker', label: 'Marker' },
	{ id: 'brush', label: 'Brush' },
] as const

export const BRUSH_WIDTHS = [2, 4, 8] as const

export const SHAPE_COLORS = [
	{ value: '#5b5fc7', label: 'Indigo' },
	{ value: '#0f6cbd', label: 'Blue' },
	{ value: '#107c10', label: 'Green' },
	{ value: '#b45309', label: 'Amber' },
	{ value: '#c42b1c', label: 'Red' },
	{ value: '#242424', label: 'Graphite' },
] as const

export const NOTE_COLORS = [
	{ value: '#fde68a', label: 'Yellow' },
	{ value: '#fbcfe8', label: 'Pink' },
	{ value: '#bbf7d0', label: 'Green' },
	{ value: '#bfdbfe', label: 'Blue' },
	{ value: '#fed7aa', label: 'Orange' },
] as const

export const FONT_OPTIONS = [
	{ id: 'sans', label: 'Sans' },
	{ id: 'serif', label: 'Serif' },
	{ id: 'hand', label: 'Hand' },
	{ id: 'mono', label: 'Mono' },
] as const

export const FONT_SIZES = [16, 24, 32, 48] as const
export const FONT_WEIGHTS = [300, 400, 500, 700] as const

export const FONT_STACKS: Record<(typeof FONT_OPTIONS)[number]['id'], string> = {
	sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
	serif: 'Georgia, "Times New Roman", serif',
	hand: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
	mono: 'ui-monospace, SFMono-Regular, monospace',
}
