import './assistant.css'
import type { AssistantActions, AssistantState } from '../contracts'
import { AssistantView } from './AssistantView'
import { useAssistantSession } from './useAssistantSession'

export interface AssistantFrameProps {
	state: AssistantState
	actions: AssistantActions
}

export function AssistantFrame({ state, actions }: AssistantFrameProps) {
	const model = useAssistantSession({ state, actions })
	return <AssistantView state={state} actions={actions} model={model} />
}
