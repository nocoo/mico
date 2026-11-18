import { Popover } from '@radix-ui/themes'
import { ChevronDown, Mic, MonitorSpeaker, PanelRightOpen, Square } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../i18n'
import type { MeetingFrameProps } from '../meeting/MeetingFrame'
import { buildMeetingViewModel } from '../meeting/viewmodel'
import '../meeting/meeting.css'
import './live.css'

export interface LiveTopbarModel {
	readonly running: boolean
	readonly phase: 'idle' | 'connecting' | 'listening' | 'stopping' | 'done' | 'error'
	readonly elapsed: string
	readonly transcript: string
	readonly detail: string
	readonly disabled: boolean
	readonly includeMeetingAudio: boolean
	readonly meetingAudioSupported: boolean
	readonly onToggleRecording: () => void
	readonly onToggleMeetingAudio: () => void
	readonly onOpenLivePanel?: () => void
}

export function LiveModeFrame({
	model,
	meeting,
}: {
	readonly model: LiveTopbarModel | null
	readonly meeting: MeetingFrameProps
}) {
	const { messages } = useI18n()
	const [open, setOpen] = useState(false)

	const meetingModel = buildMeetingViewModel({
		...meeting,
		elapsedSeconds: 0,
		messages,
	})

	const running = model?.running ?? false
	const phase = model?.phase ?? 'idle'
	const elapsed = model?.elapsed ?? '00:00'
	const transcript = model?.transcript.trim() ?? ''
	const hasTranscriptArea = running || Boolean(transcript)
	const transcriptLine =
		transcript ||
		(phase === 'connecting'
			? messages.liveTopbar.connectingText
			: phase === 'stopping'
				? messages.liveTopbar.stoppingText
				: running
					? messages.liveTopbar.listeningEmpty
					: '')

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<section
				className="live-topbar-frame"
				data-running={running ? 'true' : undefined}
				aria-label={messages.liveTopbar.panelAria}
			>
				<button
					type="button"
					className="live-topbar-mic"
					aria-pressed={running}
					aria-label={running ? messages.liveTopbar.stopLabel : messages.liveTopbar.startLabel}
					disabled={!model || model.disabled}
					onClick={model?.onToggleRecording}
				>
					{running ? <Square size={12} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
				</button>

				<div className="live-topbar-title">
					<b>{meetingModel.title}</b>
					<span>{meetingModel.detail}</span>
				</div>

				<div className="meeting-avatars">
					<span className="sr-only">{messages.meeting.participantsSr}</span>
					{meetingModel.participants.map((participant) => (
						<span
							key={participant.id}
							className="meeting-avatar"
							role="img"
							style={{ background: participant.hexColor }}
							title={
								participant.isSelf
									? `${participant.name} (${messages.common.you})`
									: participant.name
							}
							aria-label={participant.name}
						>
							{participant.initial}
						</span>
					))}
					{meetingModel.overflowCount > 0 && (
						<span className="meeting-avatar meeting-avatar-more" aria-hidden="true">
							+{meetingModel.overflowCount}
						</span>
					)}
				</div>

				<span className="live-topbar-divider" aria-hidden="true" />

				<div className="live-topbar-status">
					<span className="live-topbar-badge">
						<span className="live-topbar-dot" aria-hidden="true" />
						<time className="live-topbar-timer">{elapsed}</time>
					</span>
					<div
						className="live-topbar-transcript"
						data-expanded={hasTranscriptArea ? 'true' : undefined}
						data-active={transcript ? 'true' : undefined}
						aria-live="polite"
						aria-hidden={!hasTranscriptArea}
					>
						<span key={transcriptLine} className="live-topbar-transcript-text">
							{transcriptLine}
						</span>
					</div>
				</div>

				{model && (
					<Popover.Trigger>
						<button
							type="button"
							className="live-topbar-more"
							aria-label={messages.liveTopbar.toggleOptions}
							aria-expanded={open}
						>
							<ChevronDown size={14} aria-hidden="true" />
						</button>
					</Popover.Trigger>
				)}
			</section>

			{model && (
				<Popover.Content
					className="live-topbar-popover floating-panel"
					side="bottom"
					align="end"
					sideOffset={10}
					collisionPadding={14}
				>
					<header className="live-topbar-popover-header">
						<strong>{messages.liveTopbar.title}</strong>
						<span className="live-topbar-popover-timer">{elapsed}</span>
					</header>

					{model.detail && (
						<p className="live-topbar-popover-error" role="alert">
							{model.detail}
						</p>
					)}

					{model.meetingAudioSupported && (
						<div className="live-topbar-popover-row">
							<div className="live-topbar-popover-copy">
								<span className="live-topbar-popover-label">
									<MonitorSpeaker size={14} aria-hidden="true" />
									<span>{messages.liveTopbar.includeMeetingAudio}</span>
								</span>
								<span className="live-topbar-popover-hint">
									{messages.liveTopbar.includeMeetingHint}
								</span>
							</div>
							<button
								type="button"
								role="switch"
								aria-label={messages.liveTopbar.includeMeetingAudio}
								aria-checked={model.includeMeetingAudio}
								className="demo-switch"
								disabled={model.running || model.disabled}
								onClick={model.onToggleMeetingAudio}
							>
								<span className="demo-switch-thumb" aria-hidden="true" />
							</button>
						</div>
					)}

					{model.onOpenLivePanel && (
						<button
							type="button"
							className="live-topbar-popover-btn"
							onClick={() => {
								setOpen(false)
								model.onOpenLivePanel?.()
							}}
						>
							<PanelRightOpen size={14} aria-hidden="true" />
							<span>{messages.liveTopbar.openAssistantHint}</span>
						</button>
					)}
				</Popover.Content>
			)}
		</Popover.Root>
	)
}
