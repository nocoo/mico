import { Mic, Square } from 'lucide-react'
import { useI18n } from '../../i18n'
import { AudioSourceCard } from './AudioSourceCard'
import { type MossAssistantStatus, type MossViewModel, useMossViewModel } from './useMossViewModel'

interface MossPanelProps {
	active: boolean
	canvasId: string
	selectedIds: string[]
	onStatusChange: (status: MossAssistantStatus | null) => void
	model?: MossViewModel
}

export function MossPanel(props: MossPanelProps) {
	if (props.model) return <MossPanelView model={props.model} />
	return <StandaloneMossPanel {...props} />
}

function StandaloneMossPanel({ active, canvasId, selectedIds, onStatusChange }: MossPanelProps) {
	const model = useMossViewModel({ active, canvasId, selectedIds, onStatusChange })
	return <MossPanelView model={model} />
}

function MossPanelView({ model }: { readonly model: MossViewModel }) {
	const { messages } = useI18n()
	const usingHelper = model.audioSource === 'helper'
	const helperNeedsPermission = usingHelper && model.helperStatus === 'needs-permission'
	const showTimer = model.phase !== 'idle'
	const phaseKind = model.phase === 'idle' && helperNeedsPermission ? 'warn' : model.phaseKind
	const phaseLabel =
		model.phase === 'idle' && helperNeedsPermission
			? messages.assistant.live.phaseSetupNeeded
			: model.phaseLabel

	let actionLabel: string | null = null
	if (model.phase === 'listening') {
		actionLabel = messages.assistant.live.tapToStop
	} else if (model.phase !== 'connecting') {
		if (usingHelper) {
			actionLabel = helperNeedsPermission ? null : messages.assistant.live.tapToStartHelper
		} else {
			actionLabel = messages.assistant.live.tapToStart
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
							onClick={model.running ? model.stop : model.start}
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
					{model.showActivity && <span className="call-ai-status">{model.activity}</span>}
					<AudioSourceCard
						audioSource={model.audioSource}
						helperStatus={model.helperStatus}
						helperDevice={model.helperDevice}
						onOpenHelperPermissions={model.openHelperPermissions}
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
					<div className="call-caption moss-transcripts" aria-live="polite">
						<span className="lesson-live-label">{messages.assistant.live.transcriptLabel}</span>
						{model.transcript.user && (
							<p>
								<strong>{messages.common.you}</strong> {model.transcript.user}
							</p>
						)}
						{model.transcript.assistant && (
							<p>
								<strong>Mico</strong> {model.transcript.assistant}
							</p>
						)}
						{!model.hasTranscript && (
							<p className="lesson-live-empty">
								{model.running
									? messages.assistant.live.listening
									: messages.assistant.live.waiting}
							</p>
						)}
					</div>
				</div>
				{!model.hasOutput && (
					<span className="call-footnote">{messages.assistant.live.mossDisclosure}</span>
				)}
			</div>
		</div>
	)
}
