import { AudioLines, FileText, LoaderCircle, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { SelectField } from '../../SelectField'
import { formatClock } from '../../stt/transcript'
import { type UseLessonViewModelProps, useLessonViewModel } from './useLessonViewModel'

export type { LessonSegment } from './useLessonViewModel'

interface LessonPanelProps extends UseLessonViewModelProps {
	onSummary: () => void
	canSummarize: boolean
}

export function LessonPanel({ onSummary, canSummarize, ...viewModelProps }: LessonPanelProps) {
	const model = useLessonViewModel(viewModelProps)

	return (
		<div className="lesson">
			<div className="lesson-clip">
				<span className="lesson-rec-icon" aria-hidden="true">
					<AudioLines size={18} strokeWidth={2} />
				</span>
				<div className="lesson-rec-main">
					<SelectField
						label="Recording"
						value={model.selected?.id ?? ''}
						options={model.clips.map((clip) => ({
							value: clip.id,
							label: `${clip.lang === 'zh' ? '中文' : clip.lang === 'ja' ? '日本語' : 'EN'} · ${clip.subject} · ${clip.title}`,
						}))}
						onChange={model.selectClip}
						disabled={model.clips.length === 0}
					/>
					<div className="lesson-meta">
						<span>
							{model.selected
								? `${model.selected.subject} · ${model.selected.voice}`
								: 'Loading recordings…'}
						</span>
					</div>
				</div>
				<span className="lesson-duration">{formatClock(model.duration)}</span>
			</div>

			<div className="lesson-status" data-kind={model.phaseKind}>
				<span className="lesson-dot" data-kind={model.phaseKind} aria-hidden="true" />
				<span>{model.detail || model.phaseLabel}</span>
				<span className="lesson-ai">
					<span
						className="lesson-ai-dot"
						data-busy={model.aiBusy ? 'true' : 'false'}
						aria-hidden="true"
					/>
					{model.aiLabel}
				</span>
			</div>

			<canvas ref={model.waveRef} className="lesson-wave" height={52} />
			<div className="lesson-times">
				<span>{formatClock(model.progress)}</span>
				<span>{formatClock(model.duration)}</span>
			</div>

			<div className="lesson-transcript">
				<div className="lesson-segments-head">
					<span>Live transcript</span>
					<span>
						{model.totalSegments} /{' '}
						{model.segments.reduce((sum, segment) => sum + segment.text.length, 0)} chars
					</span>
				</div>
				<div className="lesson-transcript-body">
					<div className="lesson-live" aria-live="polite">
						<p>
							{!model.live.confirmed && !model.live.hypothesis && (
								<span className="lesson-live-empty">Waiting for speech…</span>
							)}
							<span className="lesson-confirmed">{model.live.confirmed}</span>
							<span className="lesson-hypothesis">{model.live.hypothesis}</span>
							<span className="lesson-caret" aria-hidden="true" />
						</p>
					</div>
					<div className="lesson-segments">
						<span className="lesson-confirmed-label">Confirmed segments</span>
						<ol>
							{model.segments.map((segment) => (
								<li key={segment.id}>
									<span className="lesson-seg-time">
										{segment.start.toFixed(1)}–{segment.end.toFixed(1)}s
									</span>
									<span>{segment.text}</span>
								</li>
							))}
							{model.segments.length === 0 && (
								<li className="lesson-seg-empty">
									<LoaderCircle size={14} strokeWidth={2} aria-hidden="true" />
									Play a recording to transcribe it sentence by sentence.
								</li>
							)}
						</ol>
					</div>
				</div>
			</div>

			<div className="lesson-controls">
				<button type="button" className="lesson-primary" onClick={model.toggle}>
					{model.playing ? (
						<Pause size={16} strokeWidth={2} aria-hidden="true" />
					) : (
						<Play size={16} strokeWidth={2} aria-hidden="true" />
					)}
					{model.playing ? 'Pause' : model.phase === 'streaming' ? 'Resume' : 'Play recording'}
				</button>
				<button type="button" className="lesson-button" onClick={() => void model.resetAndStart()}>
					<RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
					Restart
				</button>
				<button type="button" className="lesson-button" onClick={model.createCanvas}>
					<Plus size={15} strokeWidth={2} aria-hidden="true" />
					New canvas
				</button>
			</div>

			<div className="lesson-summary-row">
				<button
					type="button"
					className="lesson-summary"
					disabled={!canSummarize}
					onClick={onSummary}
				>
					<FileText size={15} strokeWidth={2} aria-hidden="true" />
					Create session summary
				</button>
			</div>

			<div className="lesson-metrics">
				<div>
					<span className="lesson-metric-label">Played</span>
					<b>{model.stats.played.toFixed(1)}s</b>
				</div>
				<div>
					<span className="lesson-metric-label">Sent</span>
					<b>{model.stats.sent.toFixed(1)}s</b>
				</div>
				<div>
					<span className="lesson-metric-label">Segments</span>
					<b>{model.totalSegments}</b>
				</div>
				<div>
					<span className="lesson-metric-label">Latency</span>
					<b>{model.stats.latency == null ? '—' : `${model.stats.latency.toFixed(0)}ms`}</b>
				</div>
			</div>

			<div className="lesson-sliders">
				<label>
					<span>
						Silence cut <b>{model.silenceMs}ms</b>
					</span>
					<input
						type="range"
						min={250}
						max={1000}
						step={50}
						value={model.silenceMs}
						onChange={(event) => model.changeSilence(Number(event.target.value))}
					/>
				</label>
				<label>
					<span>
						Speed <b>{model.rate.toFixed(2).replace(/0$/, '')}×</b>
					</span>
					<input
						type="range"
						min={0.75}
						max={2}
						step={0.25}
						value={model.rate}
						onChange={(event) => model.changeRate(Number(event.target.value))}
					/>
				</label>
			</div>

			<div className="lesson-vad">
				<span>Energy</span>
				<div className="lesson-meter">
					<i
						data-speaking={model.vad.speaking ? 'true' : 'false'}
						style={{
							width: `${Math.max(0, Math.min(100, ((model.vad.db + 60) / 54) * 100))}%`,
						}}
					/>
				</div>
				<span className="lesson-vad-label">
					{model.phase === 'streaming'
						? model.vad.speaking
							? `speech · ${model.vad.db.toFixed(0)}dB`
							: `silence · ${model.vad.db.toFixed(0)}dB`
						: 'idle'}
				</span>
			</div>
		</div>
	)
}
