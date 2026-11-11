import { Mic, Square } from 'lucide-react'
import type { LessonSegment } from './LessonPanel'
import { useMicrophoneViewModel } from './useMicrophoneViewModel'

interface MicrophonePanelProps {
	active: boolean
	aiBusy: boolean
	aiQueued: number
	aiError: boolean
	onStart: () => void
	onSegment: (segment: LessonSegment) => void
	onSessionEnd: () => void
	summaryRequesting: boolean
}

export function MicrophonePanel(props: MicrophonePanelProps) {
	const model = useMicrophoneViewModel(props)

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
							aria-label={model.running ? 'Stop recording' : 'Start recording'}
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
					<span className="call-action-label">
						{model.running ? 'Tap to end the conversation' : 'Tap the microphone to start'}
					</span>
					<span className="call-ai-status">{model.aiLabel}</span>
				</div>
				<div className="call-output" aria-hidden={!model.hasOutput}>
					<div className="call-wave-group">
						<canvas
							ref={model.waveRef}
							className="call-wave"
							height={52}
							role="img"
							aria-label="Microphone waveform"
						/>
					</div>
					<div className="call-caption" aria-live="polite">
						<span className="lesson-live-label">Live transcript</span>
						<p>
							{!model.live.confirmed && !model.live.hypothesis ? (
								<span className="lesson-live-empty">
									{model.running ? 'Listening for speech…' : 'Waiting for speech…'}
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
