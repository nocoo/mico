import { useState } from 'react'
import { shouldShowEmptyState } from './viewmodel'

interface EmptyStateInput {
	canvasId: string
	shapeCount: number
	initialPrompt: string
	openAssistant: () => void
}

export function useEmptyStateViewModel({
	canvasId,
	shapeCount,
	initialPrompt,
	openAssistant,
}: EmptyStateInput) {
	const [dismissedCanvasId, setDismissedCanvasId] = useState('')
	const dismiss = () => setDismissedCanvasId(canvasId)
	return {
		visible: shouldShowEmptyState(canvasId, shapeCount, dismissedCanvasId, initialPrompt),
		dismiss,
		openAssistant: () => {
			dismiss()
			openAssistant()
		},
	}
}
