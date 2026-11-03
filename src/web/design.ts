export const CONTROL_TIERS = {
	compact: { control: 32, icon: 16 },
	standard: { control: 40, icon: 20 },
	roomy: { control: 48, icon: 24 },
} as const

export const TEXT_TIERS = { small: 12, standard: 14, large: 16 } as const
export type ControlTier = keyof typeof CONTROL_TIERS
export type TextTier = keyof typeof TEXT_TIERS
export type Tool = 'select' | 'hand' | 'rectangle' | 'ellipse' | 'text' | 'line' | 'connector'

export const SHAPE_COLORS = [
	{ value: '#5b5fc7', label: 'Indigo' },
	{ value: '#0f6cbd', label: 'Blue' },
	{ value: '#107c10', label: 'Green' },
	{ value: '#b45309', label: 'Amber' },
	{ value: '#c42b1c', label: 'Red' },
	{ value: '#242424', label: 'Graphite' },
] as const
