import { Mic, Square } from 'lucide-react'
import { useMossViewModel } from './useMossViewModel'

interface MossPanelProps {
	active: boolean
	canvasId: string
	selectedIds: string[]
}

export function MossPanel({ active, canvasId, selectedIds }: MossPanelProps) {
	const model = useMossViewModel({ active, canvasId, selectedIds })

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
							onClick={model.running ? model.stop : model.start}
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
					<span className="call-ai-status">{model.activity}</span>
					<span className="call-ai-status">Audio and canvas context are sent to MOSS.</span>
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
					<div className="call-caption moss-transcripts" aria-live="polite">
						{model.transcript.user && (
							<p>
								<strong>You</strong> {model.transcript.user}
							</p>
						)}
						{model.transcript.assistant && (
							<p>
								<strong>Mico</strong> {model.transcript.assistant}
							</p>
						)}
						{!model.hasTranscript && (
							<p>{model.running ? 'Listening for speech…' : 'Waiting for speech…'}</p>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
