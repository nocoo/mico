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

export const CANDY_COLORS = {
	blue: '#3b82f6',
	green: '#22c55e',
	yellow: '#facc15',
	pink: '#f472b6',
	ink: '#263248',
} as const

export const CANDY_TINTS = {
	blue: '#dbeafe',
	green: '#dcfce7',
	yellow: '#fef3c7',
	pink: '#fce7f3',
	neutral: '#f1f5f9',
} as const

export const CANDY_LAYOUT = {
	blueHover: '#2563eb',
	textPreset: '#1d4ed8',
	linePreset: '#166534',
	yellowPreset: '#a16207',
	pinkPreset: '#9d174d',
	grid: '#dfe5ec',
	canvas: '#f8fafc',
	inkSecondary: '#5b6575',
	inkMuted: '#5b6575',
	surfaceHover: '#e2e8f0',
	border: '#dbe3ef',
	borderStrong: '#94a3b8',
	greenStatus: '#15803d',
	warning: '#a16207',
	danger: '#be123c',
} as const

export function initializeCandyPalette(root: HTMLElement): void {
	const properties: Record<string, string> = {
		'--candy-blue': CANDY_COLORS.blue,
		'--candy-blue-hover': CANDY_LAYOUT.blueHover,
		'--candy-blue-tint': CANDY_TINTS.blue,
		'--candy-green': CANDY_COLORS.green,
		'--candy-green-tint': CANDY_TINTS.green,
		'--candy-yellow': CANDY_COLORS.yellow,
		'--candy-yellow-tint': CANDY_TINTS.yellow,
		'--candy-pink': CANDY_COLORS.pink,
		'--candy-pink-tint': CANDY_TINTS.pink,
		'--candy-ink': CANDY_COLORS.ink,
		'--candy-neutral-tint': CANDY_TINTS.neutral,
		'--candy-grid': CANDY_LAYOUT.grid,
		'--candy-canvas': CANDY_LAYOUT.canvas,
		'--candy-ink-secondary': CANDY_LAYOUT.inkSecondary,
		'--candy-ink-muted': CANDY_LAYOUT.inkMuted,
		'--candy-green-status': CANDY_LAYOUT.greenStatus,
		'--candy-surface-hover': CANDY_LAYOUT.surfaceHover,
		'--candy-border': CANDY_LAYOUT.border,
		'--candy-border-strong': CANDY_LAYOUT.borderStrong,
		'--candy-warning': CANDY_LAYOUT.warning,
		'--candy-danger': CANDY_LAYOUT.danger,
	}
	for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value)
}

export const SHAPE_COLORS = [
	{ value: CANDY_LAYOUT.textPreset, label: 'Blue' },
	{ value: CANDY_LAYOUT.linePreset, label: 'Green' },
	{ value: CANDY_LAYOUT.yellowPreset, label: 'Yellow' },
	{ value: CANDY_LAYOUT.pinkPreset, label: 'Pink' },
	{ value: CANDY_COLORS.ink, label: 'Ink' },
] as const

export const NOTE_COLORS = [
	{ value: CANDY_TINTS.yellow, label: 'Yellow' },
	{ value: CANDY_TINTS.pink, label: 'Pink' },
	{ value: CANDY_TINTS.green, label: 'Green' },
	{ value: CANDY_TINTS.blue, label: 'Blue' },
	{ value: CANDY_TINTS.neutral, label: 'Neutral' },
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
