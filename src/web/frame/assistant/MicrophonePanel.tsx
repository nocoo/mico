import { Mic, Square } from 'lucide-react'
import { useI18n } from '../../i18n'
import { AudioSourceCard } from './AudioSourceCard'
import type { LessonSegment } from './LessonPanel'
import { type MicrophoneViewModel, useMicrophoneViewModel } from './useMicrophoneViewModel'

interface MicrophonePanelProps {
	active: boolean
	aiBusy: boolean
	aiQueued: number
	aiError: boolean
	onStart: () => void
	onSegment: (segment: LessonSegment) => void
	onSessionEnd: () => void
	summaryRequesting: boolean
	model?: MicrophoneViewModel
}

export function MicrophonePanel(props: MicrophonePanelProps) {
	if (props.model) return <MicrophonePanelView model={props.model} />
	return <StandaloneMicrophonePanel {...props} />
}

function StandaloneMicrophonePanel(props: MicrophonePanelProps) {
	const model = useMicrophoneViewModel(props)
	return <MicrophonePanelView model={model} />
}

function MicrophonePanelView({ model }: { readonly model: MicrophoneViewModel }) {
	const { messages } = useI18n()
	const usingHelper = model.audioSource === 'helper'
	const helperNeedsPermission = usingHelper && model.helperStatus === 'needs-permission'
	const showTimer = model.phase !== 'idle'
	const showAiStatus = model.phase === 'listening' || model.aiActive
	const phaseKind = model.phase === 'idle' && helperNeedsPermission ? 'warn' : model.phaseKind
	const phaseLabel =
		model.phase === 'idle' && helperNeedsPermission
			? messages.assistant.live.phaseSetupNeeded
			: model.phaseLabel

	let actionLabel: string | null = null
	if (model.phase === 'listening') {
		actionLabel = messages.assistant.live.tapToStop
	} else if (model.phase !== 'connecting' && model.phase !== 'stopping') {
		if (usingHelper) {
			actionLabel = helperNeedsPermission ? null : messages.assistant.live.tapToStartHelper
		} else {
			actionLabel = model.includeMeetingAudio
				? messages.assistant.live.tapToShareAndStart
				: messages.assistant.live.tapToStart
		}
	}

	return (
		<div className="microphone-panel">
			<div className={`call-stage${model.hasOutput ? ' has-output' : ''}`}>
				{model.detail && (
					<p className="call-error" role="alert">
						{model.detail}
					</p>
				)}
				<div className="call-presence">
					<div className="call-control">
						<button
							type="button"
							className="call-mic"
							aria-pressed={model.running}
							aria-label={
								model.running
									? messages.assistant.live.stopRecording
									: messages.assistant.live.startRecording
							}
							disabled={model.disabled}
							onClick={model.toggleRecording}
						>
							<Mic className="call-mic-icon" size={28} aria-hidden="true" />
							<Square className="call-end-icon" size={28} aria-hidden="true" />
						</button>
					</div>
					<div className="call-meta" aria-live="polite">
						<div className="lesson-status">
							<span className="lesson-dot" data-kind={phaseKind} />
							<span>{phaseLabel}</span>
						</div>
						{showTimer && <span className="call-timer">{model.elapsed}</span>}
					</div>
					{actionLabel && <span className="call-action-label">{actionLabel}</span>}
					{showAiStatus && <span className="call-ai-status">{model.aiLabel}</span>}
					<AudioSourceCard
						audioSource={model.audioSource}
						helperStatus={model.helperStatus}
						helperDevice={model.helperDevice}
						onOpenHelperPermissions={model.openHelperPermissions}
						showBrowserMeetingToggle={model.meetingAudioSupported}
						includeMeetingAudio={model.includeMeetingAudio}
						onToggleMeetingAudio={model.toggleMeetingAudio}
						toggleDisabled={model.running || model.disabled}
					/>
				</div>
				<div className="call-output" aria-hidden={!model.hasOutput}>
					<div className="call-wave-group">
						<canvas
							ref={model.waveRef}
							className="call-wave"
							height={52}
							role="img"
							aria-label={messages.assistant.live.waveformLabel}
						/>
					</div>
					<div className="call-caption" aria-live="polite">
						<span className="lesson-live-label">{messages.assistant.live.transcriptLabel}</span>
						<p>
							{!model.live.confirmed && !model.live.hypothesis ? (
								<span className="lesson-live-empty">
									{model.running
										? messages.assistant.live.listening
										: messages.assistant.live.waiting}
								</span>
							) : (
								<>
									<span className="lesson-confirmed">{model.live.confirmed}</span>
									<span className="lesson-hypothesis">{model.live.hypothesis}</span>
								</>
							)}
						</p>
					</div>
				</div>
			</div>
		</div>
	)
}
