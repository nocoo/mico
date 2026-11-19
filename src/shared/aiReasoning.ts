export const REASONING_EFFORTS = [
	'none',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'omit',
] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export const DEFAULT_LECTURE_REASONING: ReasoningEffort = 'none'
export const DEFAULT_CHAT_REASONING: ReasoningEffort = 'low'

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return typeof value === 'string' && REASONING_EFFORTS.includes(value as ReasoningEffort)
}

export const REASONING_EFFORT_OPTIONS: readonly { value: ReasoningEffort; label: string }[] = [
	{ value: 'none', label: 'None' },
	{ value: 'minimal', label: 'Minimal' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
	{ value: 'xhigh', label: 'Extra high' },
	{ value: 'omit', label: 'Omit' },
]
