import './assistant.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssistantActions, AssistantState } from '../contracts'
import type { LiveTopbarModel } from '../live/LiveModeFrame'
import { AssistantView } from './AssistantView'
import type { LessonSegment } from './LessonPanel'
import { useAssistantSession } from './useAssistantSession'
import { useMicrophoneViewModel } from './useMicrophoneViewModel'
import {
	type MossAssistantStatus,
	mossAssistantActivity,
	useMossViewModel,
} from './useMossViewModel'

export interface AssistantFrameProps {
	state: AssistantState
	actions: AssistantActions
	openLiveSignal?: number
	onLiveStateChange?: (live: LiveTopbarModel | null) => void
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

export function AssistantFrame({
	state,
	actions,
	openLiveSignal,
	onLiveStateChange,
}: AssistantFrameProps) {
	const model = useAssistantSession({ state, actions })
	const isMossLive = state.mossEnabled && model.liveProvider === 'moss'
	const moss = useAssistantMossStatus({
		enabled: isMossLive && state.open && model.tab === 'live',
		canvasId: state.canvasId,
		fallback: model.activity,
	})
	const mossModel = useMossViewModel({
		active: isMossLive && state.open && model.tab === 'live',
		canvasId: state.canvasId,
		selectedIds: state.selectedIds,
		onStatusChange: moss.onStatusChange,
	})
	const micModel = useMicrophoneViewModel({
		active: !isMossLive && state.open && model.tab === 'live',
		canvasId: state.canvasId,
		aiBusy: model.busy,
		aiQueued: model.lectureQueued,
		aiError: Boolean(model.error),
		onStart: model.startMicrophone,
		onSegment: (segment: LessonSegment) =>
			model.enqueueLecture(segment, { subject: 'Live speech', title: 'Microphone' }),
		onSessionEnd: model.endSession,
		summaryRequesting: model.summaryRequesting,
	})

	const lastLiveSignal = useRef(openLiveSignal ?? 0)
	useEffect(() => {
		if (openLiveSignal !== undefined && openLiveSignal !== lastLiveSignal.current) {
			lastLiveSignal.current = openLiveSignal
			model.setTab('live')
			model.selectLiveProvider('mai')
		}
	}, [openLiveSignal, model.setTab, model.selectLiveProvider])

	useEffect(() => {
		if (!onLiveStateChange) return
		const transcript = `${micModel.live.confirmed}${micModel.live.hypothesis}`
		onLiveStateChange({
			running: micModel.running,
			phase: micModel.phase,
			elapsed: micModel.elapsed,
			transcript,
			detail: micModel.detail,
			disabled: micModel.disabled,
			includeMeetingAudio: micModel.includeMeetingAudio,
			meetingAudioSupported: micModel.meetingAudioSupported,
			onToggleRecording: micModel.toggleFromTopbar,
			onToggleMeetingAudio: micModel.toggleMeetingAudio,
		})
	}, [
		onLiveStateChange,
		micModel.running,
		micModel.phase,
		micModel.elapsed,
		micModel.live.confirmed,
		micModel.live.hypothesis,
		micModel.detail,
		micModel.disabled,
		micModel.includeMeetingAudio,
		micModel.meetingAudioSupported,
		micModel.toggleFromTopbar,
		micModel.toggleMeetingAudio,
	])

	useEffect(() => () => onLiveStateChange?.(null), [onLiveStateChange])

	return (
		<AssistantView
			state={state}
			actions={actions}
			model={model}
			micModel={micModel}
			mossModel={mossModel}
			mossActivity={moss.activity}
			onMossStatusChange={moss.onStatusChange}
		/>
	)
}
