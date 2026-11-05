import {
	type AnimationEvent as ReactAnimationEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useEffect,
	useReducer,
	useRef,
} from 'react'
import type { IdentityActions, IdentityState } from '../contracts'
import {
	createIdentityViewModel,
	getRenameCommitName,
	type IdentityViewModel,
	identityInteractionReducer,
	initialIdentityInteractionState,
} from './identityViewModel'

export interface IdentityFrameViewModel extends IdentityViewModel {
	mounted: boolean
	renamingId: string | null
	renameValue: string
	confirmDeleteId: string | null
	panelRef: RefObject<HTMLElement | null>
	renameInputRef: RefObject<HTMLInputElement | null>
	beginRename: (id: string, name: string) => void
	setRenameValue: (value: string) => void
	commitRename: (id: string) => void
	cancelRename: () => void
	requestDelete: (id: string) => void
	onPanelAnimationEnd: (event: ReactAnimationEvent<HTMLElement>) => void
	onRenameKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>, id: string) => void
}

export interface IdentityViewModelProps {
	state: IdentityState
	actions: IdentityActions
}

export function useIdentityViewModel({
	state,
	actions,
}: IdentityViewModelProps): IdentityFrameViewModel {
	const panelRef = useRef<HTMLElement>(null)
	const renameInputRef = useRef<HTMLInputElement>(null)
	const renameCancelledRef = useRef(false)
	const renameCommittedRef = useRef<string | null>(null)
	const [interaction, dispatch] = useReducer(
		identityInteractionReducer,
		state.canvasesOpen,
		initialIdentityInteractionState,
	)
	const viewModel = createIdentityViewModel(state, actions)

	useEffect(() => {
		dispatch({ type: 'sync-open', open: state.canvasesOpen })
		if (panelRef.current) panelRef.current.inert = !state.canvasesOpen
	}, [state.canvasesOpen])

	useEffect(() => {
		if (!state.canvasesOpen) return
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			if (!(target instanceof Element)) return
			if (target.closest('[data-canvas-panel], [data-canvas-toggle]')) return
			actions.closeCanvases()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			actions.closeCanvases()
			window.requestAnimationFrame(() => {
				document.querySelector<HTMLButtonElement>('[data-canvas-toggle="true"]')?.focus()
			})
		}
		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [state.canvasesOpen, actions.closeCanvases])

	useEffect(() => {
		if (!interaction.renamingId) return
		renameInputRef.current?.focus()
	}, [interaction.renamingId])

	useEffect(() => {
		if (!interaction.confirmDeleteId) return
		const timeout = window.setTimeout(() => {
			dispatch({ type: 'clear-delete-confirm' })
		}, 4000)
		return () => window.clearTimeout(timeout)
	}, [interaction.confirmDeleteId])

	const beginRename = (id: string, name: string) => {
		renameCancelledRef.current = false
		renameCommittedRef.current = null
		dispatch({ type: 'begin-rename', id, name })
	}

	const setRenameValue = (value: string) => {
		dispatch({ type: 'set-rename', value })
	}

	const commitRename = (id: string) => {
		if (renameCancelledRef.current) {
			renameCancelledRef.current = false
			dispatch({ type: 'commit-rename' })
			return
		}
		if (renameCommittedRef.current === id) return
		renameCommittedRef.current = id
		const name = getRenameCommitName(state.canvases, id, interaction.renameValue)
		dispatch({ type: 'commit-rename' })
		if (name) actions.renameCanvas(id, name)
		window.requestAnimationFrame(() => {
			if (renameCommittedRef.current === id) renameCommittedRef.current = null
		})
	}

	const cancelRename = () => {
		renameCancelledRef.current = true
		renameCommittedRef.current = null
		dispatch({ type: 'cancel-rename' })
		window.requestAnimationFrame(() => {
			document.querySelector<HTMLButtonElement>('[data-canvas-toggle="true"]')?.focus()
		})
	}

	const onRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, id: string) => {
		event.stopPropagation()
		if (event.key === 'Enter') {
			event.preventDefault()
			commitRename(id)
		}
		if (event.key === 'Escape') {
			event.preventDefault()
			cancelRename()
		}
	}

	const requestDelete = (id: string) => {
		if (interaction.confirmDeleteId === id) {
			dispatch({ type: 'clear-delete-confirm' })
			actions.deleteCanvas(id)
			return
		}
		dispatch({ type: 'request-delete', id })
	}

	const onPanelAnimationEnd = (event: ReactAnimationEvent<HTMLElement>) => {
		if (event.target === event.currentTarget && !state.canvasesOpen) {
			dispatch({ type: 'unmount' })
		}
	}

	return {
		...viewModel,
		mounted: interaction.mounted,
		renamingId: interaction.renamingId,
		renameValue: interaction.renameValue,
		confirmDeleteId: interaction.confirmDeleteId,
		panelRef,
		renameInputRef,
		beginRename,
		setRenameValue,
		commitRename,
		cancelRename,
		requestDelete,
		onPanelAnimationEnd,
		onRenameKeyDown,
	}
}
