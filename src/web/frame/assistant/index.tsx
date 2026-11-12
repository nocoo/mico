import './assistant.css'
import { useCallback, useRef, useState } from 'react'
import type { AssistantActions, AssistantState } from '../contracts'
import { AssistantView } from './AssistantView'
import { useAssistantSession } from './useAssistantSession'
import { type MossAssistantStatus, mossAssistantActivity } from './useMossViewModel'

export interface AssistantFrameProps {
	state: AssistantState
	actions: AssistantActions
}

function useAssistantMossStatus({
	enabled,
	canvasId,
	fallback,
}: {
	enabled: boolean
	canvasId: string
	fallback: { state: string; text: string }
}) {
	const key = enabled ? `moss:${canvasId}` : 'inactive'
	const contextRef = useRef({ key, generation: 0 })
	if (contextRef.current.key !== key) {
		contextRef.current = { key, generation: contextRef.current.generation + 1 }
	}
	const generation = contextRef.current.generation
	const [reported, setReported] = useState<{
		generation: number
		status: MossAssistantStatus
	} | null>(null)
	const onStatusChange = useCallback(
		(status: MossAssistantStatus | null) => {
			if (contextRef.current.generation !== generation) return
			setReported(status ? { generation, status } : null)
		},
		[generation],
	)
	const mossActivity =
		enabled && reported?.generation === generation ? mossAssistantActivity(reported.status) : null
	return { activity: mossActivity ?? fallback, onStatusChange }
}

export function AssistantFrame({ state, actions }: AssistantFrameProps) {
	const model = useAssistantSession({ state, actions })
	const moss = useAssistantMossStatus({
		enabled: state.open && model.tab === 'live' && model.liveProvider === 'moss',
		canvasId: state.canvasId,
		fallback: model.activity,
	})
	return (
		<AssistantView
			state={state}
			actions={actions}
			model={model}
			mossActivity={moss.activity}
			onMossStatusChange={moss.onStatusChange}
		/>
	)
}
