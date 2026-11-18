import { Popover } from '@radix-ui/themes'
import { ChevronDown, Mic, MonitorSpeaker, PanelRightOpen, Square } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../i18n'
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

export function LiveModeFrame({ model }: { readonly model: LiveTopbarModel }) {
	const { messages } = useI18n()
	const [open, setOpen] = useState(false)

	const transcriptLine =
		model.transcript.trim() ||
		(model.phase === 'connecting'
			? messages.liveTopbar.connectingText
			: model.phase === 'stopping'
				? messages.liveTopbar.stoppingText
				: model.running
					? messages.liveTopbar.listeningEmpty
					: messages.liveTopbar.idleText)

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<section
				className="live-topbar-frame"
				data-running={model.running ? 'true' : undefined}
				aria-label={messages.liveTopbar.panelAria}
			>
				<button
					type="button"
					className="live-topbar-mic"
					aria-pressed={model.running}
					aria-label={
						model.running ? messages.liveTopbar.stopLabel : messages.liveTopbar.startLabel
					}
					disabled={model.disabled}
					onClick={model.onToggleRecording}
				>
					{model.running ? (
						<Square size={12} aria-hidden="true" />
					) : (
						<Mic size={15} aria-hidden="true" />
					)}
				</button>

				<div className="live-topbar-status">
					<span className="live-topbar-badge">
						<span className="live-topbar-dot" aria-hidden="true" />
						<time className="live-topbar-timer">{model.elapsed}</time>
					</span>
					<div
						className="live-topbar-transcript"
						data-active={model.transcript.trim() ? 'true' : undefined}
						aria-live="polite"
					>
						<span key={transcriptLine} className="live-topbar-transcript-text">
							{transcriptLine}
						</span>
					</div>
				</div>

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
			</section>

			<Popover.Content
				className="live-topbar-popover floating-panel"
				side="bottom"
				align="end"
				sideOffset={10}
				collisionPadding={14}
			>
				<header className="live-topbar-popover-header">
					<strong>{messages.liveTopbar.title}</strong>
					<span className="live-topbar-popover-timer">{model.elapsed}</span>
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
		</Popover.Root>
	)
}
