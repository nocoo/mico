import { CANDY_COLORS, CANDY_LAYOUT, CANDY_TINTS } from '../shared/palette.ts'
import { JELLY_COLORS } from './canvas/jelly.ts'
import { FRAME_LAYOUT } from './frame/layout.ts'

export { CANDY_COLORS, CANDY_LAYOUT, CANDY_TINTS } from '../shared/palette.ts'

export const CONTROL_SIZE = FRAME_LAYOUT.controlSize
export const ICON_SIZE = FRAME_LAYOUT.iconSize
export const TEXT_SIZE = 14
export type DrawTool =
	| 'rectangle'
	| 'ellipse'
	| 'text'
	| 'line'
	| 'path'
	| 'note'
	| 'html'
	| 'image'
export type Tool = 'select' | 'hand' | 'connector' | DrawTool

export const BRUSH_STYLES = [
	{ id: 'pencil', label: 'Pencil' },
	{ id: 'marker', label: 'Marker' },
	{ id: 'brush', label: 'Brush' },
] as const

export const BRUSH_WIDTHS = [2, 4, 8] as const

export function candyWash(color: string, percent = 10): string {
	return `color-mix(in srgb, ${color} ${percent}%, var(--surface))`
}

const READABLE_TEXT: Record<string, string> = {
	[CANDY_COLORS.blue]: CANDY_LAYOUT.blueStroke,
	[CANDY_COLORS.green]: CANDY_LAYOUT.greenStroke,
	[CANDY_COLORS.yellow]: CANDY_LAYOUT.yellowStroke,
	[CANDY_COLORS.pink]: CANDY_LAYOUT.pinkStroke,
}

export function candyInk(color: string): string {
	return READABLE_TEXT[color] ?? color
}

export function canvasTextColor(color: string): string {
	return color === CANDY_COLORS.ink ? 'var(--ui-ink)' : candyInk(color)
}

export function candyLine(color: string, percent = 35): string {
	return `color-mix(in srgb, ${color} ${percent}%, var(--border))`
}

export function initializeCandyPalette(root: HTMLElement): void {
	const properties: Record<string, string> = {
		'--candy-blue': CANDY_COLORS.blue,
		'--candy-blue-hover': CANDY_LAYOUT.blueHover,
		'--candy-blue-tint': CANDY_TINTS.blue,
		'--candy-blue-stroke': CANDY_LAYOUT.blueStroke,
		'--candy-green': CANDY_COLORS.green,
		'--candy-green-tint': CANDY_TINTS.green,
		'--candy-green-stroke': CANDY_LAYOUT.greenStroke,
		'--candy-yellow': CANDY_COLORS.yellow,
		'--candy-yellow-tint': CANDY_TINTS.yellow,
		'--candy-yellow-stroke': CANDY_LAYOUT.yellowStroke,
		'--candy-pink': CANDY_COLORS.pink,
		'--candy-pink-tint': CANDY_TINTS.pink,
		'--candy-pink-stroke': CANDY_LAYOUT.pinkStroke,
		'--candy-ink': CANDY_COLORS.ink,
		'--candy-neutral-tint': CANDY_TINTS.neutral,
		'--candy-surface': CANDY_LAYOUT.surface,
		'--candy-grid': CANDY_LAYOUT.grid,
		'--candy-canvas': CANDY_LAYOUT.canvas,
		'--candy-connector': CANDY_LAYOUT.connector,
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
	{ value: CANDY_COLORS.blue, label: 'Blue' },
	{ value: CANDY_COLORS.green, label: 'Green' },
	{ value: CANDY_COLORS.yellow, label: 'Yellow' },
	{ value: CANDY_COLORS.pink, label: 'Pink' },
	{ value: JELLY_COLORS.peach, label: 'Peach' },
	{ value: JELLY_COLORS.grape, label: 'Grape' },
	{ value: CANDY_COLORS.ink, label: 'Ink' },
] as const

export const NOTE_COLORS = [
	{ value: CANDY_TINTS.yellow, label: 'Yellow' },
	{ value: CANDY_TINTS.pink, label: 'Pink' },
	{ value: CANDY_TINTS.green, label: 'Green' },
	{ value: CANDY_TINTS.blue, label: 'Blue' },
	{ value: JELLY_COLORS.peach, label: 'Peach' },
	{ value: JELLY_COLORS.grape, label: 'Grape' },
	{ value: CANDY_TINTS.neutral, label: 'Neutral' },
] as const

export const FONT_OPTIONS = [
	{ id: 'sans', label: 'Sans' },
	{ id: 'serif', label: 'Serif' },
	{ id: 'hand', label: 'Hand' },
	{ id: 'mono', label: 'Mono' },
] as const

export const FONT_SIZES = [16, 18, 24, 32, 48] as const
export const FONT_WEIGHTS = [300, 400, 500, 600, 700] as const

export const FONT_STACKS: Record<(typeof FONT_OPTIONS)[number]['id'], string> = {
	sans: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", sans-serif',
	serif: 'Georgia, "Times New Roman", serif',
	hand: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
	mono: 'ui-monospace, SFMono-Regular, monospace',
}
