import type { CanvasListItem, IdentityActions, IdentityState } from '../contracts'

export type IdentityConnectionStatus = 'offline' | 'live' | 'reconnecting'

export interface IdentityStatusView {
	status: IdentityConnectionStatus
	statusLabel: 'Offline' | 'Live' | 'Reconnecting'
	statusTitle: string
}

export interface IdentityInteractionState {
	mounted: boolean
	renamingId: string | null
	renameValue: string
	confirmDeleteId: string | null
	renameCancelled: boolean
}

export type IdentityInteractionAction =
	| { type: 'sync-open'; open: boolean }
	| { type: 'mount' }
	| { type: 'unmount' }
	| { type: 'begin-rename'; id: string; name: string }
	| { type: 'set-rename'; value: string }
	| { type: 'commit-rename' }
	| { type: 'cancel-rename' }
	| { type: 'request-delete'; id: string }
	| { type: 'clear-delete-confirm' }

export interface IdentityViewModel {
	canvases: readonly CanvasListItem[]
	activeCanvasId: string
	canvasesOpen: boolean
	status: IdentityConnectionStatus
	statusLabel: 'Offline' | 'Live' | 'Reconnecting'
	statusTitle: string
	canDeleteCanvas: boolean
	toggleCanvases: () => void
	closeCanvases: () => void
	createCanvas: () => void
	switchCanvas: (id: string) => void
	renameCanvas: (id: string, name: string) => void
	deleteCanvas: (id: string) => void
}

export function initialIdentityInteractionState(open: boolean): IdentityInteractionState {
	return {
		mounted: open,
		renamingId: null,
		renameValue: '',
		confirmDeleteId: null,
		renameCancelled: false,
	}
}

export function identityInteractionReducer(
	state: IdentityInteractionState,
	action: IdentityInteractionAction,
): IdentityInteractionState {
	switch (action.type) {
		case 'sync-open':
			return action.open ? { ...state, mounted: true } : state
		case 'mount':
			return { ...state, mounted: true }
		case 'unmount':
			return { ...state, mounted: false }
		case 'begin-rename':
			return {
				...state,
				confirmDeleteId: null,
				renamingId: action.id,
				renameValue: action.name,
				renameCancelled: false,
			}
		case 'set-rename':
			return { ...state, renameValue: action.value }
		case 'commit-rename':
			return { ...state, renamingId: null, renameCancelled: false }
		case 'cancel-rename':
			return { ...state, renamingId: null, renameCancelled: true }
		case 'request-delete':
			return { ...state, confirmDeleteId: action.id }
		case 'clear-delete-confirm':
			return { ...state, confirmDeleteId: null }
	}
}

export function deriveIdentityStatus(state: IdentityState): IdentityStatusView {
	const status: IdentityConnectionStatus = !state.apiConnected
		? 'offline'
		: state.wsConnected
			? 'live'
			: 'reconnecting'
	const statusLabel = !state.apiConnected ? 'Offline' : state.wsConnected ? 'Live' : 'Reconnecting'
	return {
		status,
		statusLabel,
		statusTitle: `Revision ${state.revision} · ${state.objectCount} objects · ${statusLabel}`,
	}
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['day', 86_400_000],
	['hour', 3_600_000],
	['minute', 60_000],
]

export function formatCanvasTime(value: string, now: number = Date.now()): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	const diff = date.getTime() - now
	const abs = Math.abs(diff)
	if (abs < 60_000) return 'just now'
	for (const [unit, ms] of RELATIVE_UNITS) {
		if (abs >= ms) {
			return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
				Math.round(diff / ms),
				unit,
			)
		}
	}
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function getRenameCommitName(
	canvases: readonly CanvasListItem[],
	id: string,
	value: string,
): string | null {
	const name = value.trim()
	if (!name) return null
	if (canvases.find((canvas) => canvas.id === id)?.name === name) return null
	return name
}

export function createIdentityViewModel(
	state: IdentityState,
	actions: IdentityActions,
): IdentityViewModel {
	const identityStatus = deriveIdentityStatus(state)
	return {
		canvases: state.canvases,
		activeCanvasId: state.activeCanvasId,
		canvasesOpen: state.canvasesOpen,
		status: identityStatus.status,
		statusLabel: identityStatus.statusLabel,
		statusTitle: identityStatus.statusTitle,
		canDeleteCanvas: state.canvases.length > 1,
		toggleCanvases: actions.toggleCanvases,
		closeCanvases: actions.closeCanvases,
		createCanvas: actions.createCanvas,
		switchCanvas: actions.switchCanvas,
		renameCanvas: actions.renameCanvas,
		deleteCanvas: actions.deleteCanvas,
	}
}
