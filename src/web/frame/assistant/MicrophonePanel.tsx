import { AudioLines, Mic, MonitorSpeaker, ShieldAlert, Square } from 'lucide-react'
import { useI18n } from '../../i18n'
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
	const helperSummary = model.helperDevice
		? `${messages.assistant.live.helperReadySummary} · ${model.helperDevice}`
		: messages.assistant.live.helperReadySummary

	const actionLabel = model.running
		? messages.assistant.live.tapToStop
		: usingHelper
			? helperNeedsPermission
				? messages.assistant.live.tapToGrantHelper
				: messages.assistant.live.tapToStartHelper
			: model.includeMeetingAudio
				? messages.assistant.live.tapToShareAndStart
				: messages.assistant.live.tapToStart

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
							<span className="lesson-dot" data-kind={model.phaseKind} />
							<span>{model.phaseLabel}</span>
						</div>
						<span className="call-timer">{model.elapsed}</span>
					</div>
					<span className="call-action-label">{actionLabel}</span>
					<span className="call-ai-status">{model.aiLabel}</span>
					{usingHelper ? (
						<div
							className="call-helper-card"
							data-state={helperNeedsPermission ? 'setup' : 'ready'}
						>
							<div className="call-helper-head">
								<span className="call-helper-title">
									{helperNeedsPermission ? (
										<ShieldAlert size={14} aria-hidden="true" />
									) : (
										<AudioLines size={14} aria-hidden="true" />
									)}
									<span>{messages.assistant.live.helperTitle}</span>
								</span>
								<span
									className="call-helper-pill"
									data-state={helperNeedsPermission ? 'setup' : 'ready'}
								>
									{helperNeedsPermission
										? messages.assistant.live.helperSetupBadge
										: messages.assistant.live.helperActiveBadge}
								</span>
							</div>
							<span className="call-helper-summary">
								{helperNeedsPermission ? messages.assistant.live.helperSetupSummary : helperSummary}
							</span>
							{helperNeedsPermission && (
								<button
									type="button"
									className="call-helper-action"
									onClick={model.openHelperPermissions}
								>
									{messages.assistant.live.helperGrantAction}
								</button>
							)}
						</div>
					) : (
						model.meetingAudioSupported && (
							<div className="call-meeting-row">
								<span className="call-meeting-label">
									<MonitorSpeaker size={14} aria-hidden="true" />
									<span>{messages.assistant.live.includeMeetingAudio}</span>
								</span>
								<button
									type="button"
									role="switch"
									aria-label={messages.assistant.live.includeMeetingAudio}
									aria-checked={model.includeMeetingAudio}
									className="demo-switch"
									disabled={model.running || model.disabled}
									onClick={model.toggleMeetingAudio}
								>
									<span className="demo-switch-thumb" aria-hidden="true" />
								</button>
							</div>
						)
					)}
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
