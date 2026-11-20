import { Popover } from '@radix-ui/themes'
import {
	AudioLines,
	ChevronDown,
	Lock,
	Mic,
	MonitorSpeaker,
	Navigation,
	PanelRightOpen,
	Pencil,
	Presentation,
	ShieldAlert,
	Square,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import type { AudioHelperStatus } from '../../stt/audioHelper'
import { formatClock } from '../../stt/transcript'
import type { LiveAudioSource } from '../assistant/useMicrophoneViewModel'
import type { MeetingFrameProps } from '../meeting/viewmodel'
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
	readonly audioSource?: LiveAudioSource
	readonly helperStatus?: AudioHelperStatus
	readonly helperDevice?: string
	readonly includeMeetingAudio: boolean
	readonly meetingAudioSupported: boolean
	readonly onToggleRecording: () => void
	readonly onToggleMeetingAudio: () => void
	readonly onOpenHelperPermissions?: () => void
	readonly onRefreshHelper?: () => void
	readonly onOpenLivePanel?: () => void
}

export interface LiveTopbarFollow {
	readonly available: boolean
	readonly following: boolean
	readonly onToggle: () => void
}

export interface LiveTopbarRemote {
	readonly active: boolean
	readonly text: string
	readonly startedAt?: number
}

export function LiveModeFrame({
	model,
	meeting,
	follow,
	remoteLive,
}: {
	readonly model: LiveTopbarModel | null
	readonly meeting: MeetingFrameProps
	readonly follow?: LiveTopbarFollow | null
	readonly remoteLive?: LiveTopbarRemote | null
}) {
	const { messages } = useI18n()
	const [open, setOpen] = useState(false)
	const [remoteElapsedSeconds, setRemoteElapsedSeconds] = useState(0)

	const remoteActive = !model && Boolean(remoteLive?.active)
	const remoteStartedAt = remoteLive?.startedAt
	useEffect(() => {
		if (!remoteActive || !remoteStartedAt) {
			setRemoteElapsedSeconds(0)
			return
		}
		const update = () => {
			setRemoteElapsedSeconds(Math.max(0, Math.floor((Date.now() - remoteStartedAt) / 1000)))
		}
		update()
		const timer = window.setInterval(update, 1000)
		return () => window.clearInterval(timer)
	}, [remoteActive, remoteStartedAt])

	const meetingModel = buildMeetingViewModel({
		...meeting,
		elapsedSeconds: 0,
		messages,
	})

	const localRunning = model?.running ?? false
	const phase = model?.phase ?? 'idle'
	const elapsed = model?.elapsed ?? (remoteActive ? formatClock(remoteElapsedSeconds) : '00:00')
	const localTranscript = model?.transcript.trim() ?? ''
	const remoteTranscript = !model ? (remoteLive?.text.trim() ?? '') : ''
	const running = localRunning || remoteActive
	const transcript = localTranscript || remoteTranscript
	const hasTranscriptArea = running || Boolean(transcript)
	const transcriptLine =
		transcript ||
		(phase === 'connecting'
			? messages.liveTopbar.connectingText
			: phase === 'stopping'
				? messages.liveTopbar.stoppingText
				: localRunning || remoteActive
					? messages.liveTopbar.listeningEmpty
					: '')

	const usingHelper = model?.audioSource === 'helper'
	const helperNeedsPermission = usingHelper && model?.helperStatus === 'needs-permission'
	const helperReadyHint = model?.helperDevice
		? `${messages.liveTopbar.helperReadyHint} · ${model.helperDevice}`
		: messages.liveTopbar.helperReadyHint

	const handleOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen)
		if (nextOpen) model?.onRefreshHelper?.()
	}

	return (
		<Popover.Root open={open} onOpenChange={handleOpenChange}>
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
							data-presenter={participant.presenter || undefined}
							data-editor={participant.editor || undefined}
							title={
								(participant.isSelf
									? `${participant.name} (${messages.common.you})`
									: participant.name) +
								(participant.editor ? ` · ${messages.meeting.canvasEditor}` : '')
							}
							aria-label={`${participant.name}, ${participant.self ? 'you, ' : ''}${participant.presenter ? 'presenter' : participant.editor ? messages.meeting.canvasEditor : 'participant'}`}
						>
							{participant.initial}
							{participant.presenter ? (
								<span className="meeting-presenter-badge" aria-hidden="true">
									<Presentation />
								</span>
							) : participant.editor ? (
								<span className="meeting-editor-badge" aria-hidden="true">
									<Pencil />
								</span>
							) : null}
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

				{follow?.available && (
					<button
						type="button"
						className="live-topbar-follow"
						aria-pressed={follow.following}
						aria-label={
							follow.following
								? messages.liveTopbar.stopFollowingAria
								: messages.liveTopbar.followPresenterAria
						}
						onClick={follow.onToggle}
					>
						{follow.following ? (
							<Lock size={12} aria-hidden="true" />
						) : (
							<Navigation size={12} aria-hidden="true" />
						)}
						<span>
							{follow.following
								? messages.liveTopbar.followingPresenter
								: messages.liveTopbar.followPresenter}
						</span>
					</button>
				)}

				{model && (
					<Popover.Trigger>
						<button
							type="button"
							className="live-topbar-more"
							data-attention={helperNeedsPermission ? 'true' : undefined}
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

					{usingHelper ? (
						<div
							className="live-topbar-helper-row"
							data-state={helperNeedsPermission ? 'setup' : 'ready'}
						>
							<div className="live-topbar-helper-head">
								<span className="live-topbar-popover-label">
									{helperNeedsPermission ? (
										<ShieldAlert size={14} aria-hidden="true" />
									) : (
										<AudioLines size={14} aria-hidden="true" />
									)}
									<span>{messages.liveTopbar.helperTitle}</span>
								</span>
								<span
									className="live-helper-pill"
									data-state={helperNeedsPermission ? 'setup' : 'ready'}
								>
									{helperNeedsPermission
										? messages.liveTopbar.helperSetupBadge
										: messages.liveTopbar.helperActiveBadge}
								</span>
							</div>
							<span className="live-topbar-popover-hint">
								{helperNeedsPermission ? messages.liveTopbar.helperSetupHint : helperReadyHint}
							</span>
							{helperNeedsPermission && model.onOpenHelperPermissions && (
								<button
									type="button"
									className="live-helper-action"
									onClick={model.onOpenHelperPermissions}
								>
									{messages.liveTopbar.helperGrantAction}
								</button>
							)}
						</div>
					) : (
						model.meetingAudioSupported && (
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
						)
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
