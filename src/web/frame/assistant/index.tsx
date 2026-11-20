import './assistant.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssistantActions, AssistantState } from '../contracts'
import type { LiveTopbarModel } from '../live/LiveModeFrame'
import { AssistantView } from './AssistantView'
import type { LessonSegment } from './LessonPanel'
import { useAssistantSession } from './useAssistantSession'
import { useAudioHelper } from './useAudioHelper'
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
	const [helperCapturing, setHelperCapturing] = useState(false)
	const audioHelper = useAudioHelper({
		active: state.open && model.tab === 'live',
		capturing: helperCapturing,
	})
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
		audioHelper,
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
		audioHelper,
	})
	useEffect(() => {
		setHelperCapturing(micModel.running || mossModel.running)
	}, [micModel.running, mossModel.running])

	const lastLiveSignal = useRef(openLiveSignal ?? 0)
	useEffect(() => {
		if (openLiveSignal !== undefined && openLiveSignal !== lastLiveSignal.current) {
			lastLiveSignal.current = openLiveSignal
			model.setTab('live')
			model.selectLiveProvider('mai')
		}
	}, [openLiveSignal, model.setTab, model.selectLiveProvider])

	const liveEmitTimer = useRef<number | null>(null)
	const lastLiveMeta = useRef('')
	const latestLivePayload = useRef<Parameters<NonNullable<typeof onLiveStateChange>>[0]>(null)

	useEffect(() => {
		if (!onLiveStateChange) return
		const transcript = `${micModel.live.confirmed}${micModel.live.hypothesis}`
		const payload = {
			running: micModel.running,
			phase: micModel.phase,
			elapsed: micModel.elapsed,
			transcript,
			detail: micModel.detail,
			disabled: micModel.disabled,
			audioSource: micModel.audioSource,
			helperStatus: micModel.helperStatus,
			helperDevice: micModel.helperDevice,
			includeMeetingAudio: micModel.includeMeetingAudio,
			meetingAudioSupported: micModel.meetingAudioSupported,
			onToggleRecording: micModel.toggleFromTopbar,
			onToggleMeetingAudio: micModel.toggleMeetingAudio,
			onOpenHelperPermissions: micModel.openHelperPermissions,
			onRefreshHelper: micModel.refreshHelper,
		}
		latestLivePayload.current = payload
		const meta = [
			micModel.running,
			micModel.phase,
			micModel.detail,
			micModel.disabled,
			micModel.audioSource,
			micModel.helperStatus,
			micModel.helperDevice,
			micModel.includeMeetingAudio,
			micModel.meetingAudioSupported,
		].join('|')
		if (meta !== lastLiveMeta.current) {
			lastLiveMeta.current = meta
			if (liveEmitTimer.current !== null) {
				window.clearTimeout(liveEmitTimer.current)
				liveEmitTimer.current = null
			}
			onLiveStateChange(payload)
			return
		}
		if (liveEmitTimer.current === null) {
			liveEmitTimer.current = window.setTimeout(() => {
				liveEmitTimer.current = null
				onLiveStateChange(latestLivePayload.current)
			}, 120)
		}
	}, [
		onLiveStateChange,
		micModel.running,
		micModel.phase,
		micModel.elapsed,
		micModel.live.confirmed,
		micModel.live.hypothesis,
		micModel.detail,
		micModel.disabled,
		micModel.audioSource,
		micModel.helperStatus,
		micModel.helperDevice,
		micModel.includeMeetingAudio,
		micModel.meetingAudioSupported,
		micModel.toggleFromTopbar,
		micModel.toggleMeetingAudio,
		micModel.openHelperPermissions,
		micModel.refreshHelper,
	])

	useEffect(
		() => () => {
			if (liveEmitTimer.current !== null) {
				window.clearTimeout(liveEmitTimer.current)
				liveEmitTimer.current = null
			}
			onLiveStateChange?.(null)
		},
		[onLiveStateChange],
	)

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
