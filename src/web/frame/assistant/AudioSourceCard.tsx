import { AudioLines, MonitorSpeaker, ShieldAlert } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { AudioHelperStatus } from '../../stt/audioHelper'
import type { LiveAudioSource } from './useAudioHelper'

export interface AudioSourceCardProps {
	readonly audioSource: LiveAudioSource
	readonly helperStatus: AudioHelperStatus
	readonly helperDevice: string
	readonly onOpenHelperPermissions: () => void
	readonly showBrowserMeetingToggle?: boolean
	readonly includeMeetingAudio?: boolean
	readonly onToggleMeetingAudio?: () => void
	readonly toggleDisabled?: boolean
}

export function AudioSourceCard({
	audioSource,
	helperStatus,
	helperDevice,
	onOpenHelperPermissions,
	showBrowserMeetingToggle = false,
	includeMeetingAudio = false,
	onToggleMeetingAudio,
	toggleDisabled = false,
}: AudioSourceCardProps) {
	const { messages } = useI18n()

	if (audioSource === 'helper') {
		const needsPermission = helperStatus === 'needs-permission'
		const summary = needsPermission
			? messages.assistant.live.helperSetupSummary
			: helperDevice
				? `${messages.assistant.live.helperReadySummary} · ${helperDevice}`
				: messages.assistant.live.helperReadySummary

		return (
			<div className="call-helper-card" data-state={needsPermission ? 'setup' : 'ready'}>
				<div className="call-helper-head">
					<span className="call-helper-title">
						{needsPermission ? (
							<ShieldAlert size={14} aria-hidden="true" />
						) : (
							<AudioLines size={14} aria-hidden="true" />
						)}
						<span>{messages.assistant.live.helperTitle}</span>
					</span>
					<span className="call-helper-pill" data-state={needsPermission ? 'setup' : 'ready'}>
						{needsPermission
							? messages.assistant.live.helperSetupBadge
							: messages.assistant.live.helperActiveBadge}
					</span>
				</div>
				<span className="call-helper-summary" title={summary}>
					{summary}
				</span>
				{needsPermission && (
					<button type="button" className="call-helper-action" onClick={onOpenHelperPermissions}>
						{messages.assistant.live.helperGrantAction}
					</button>
				)}
			</div>
		)
	}

	if (!showBrowserMeetingToggle || !onToggleMeetingAudio) return null

	return (
		<div className="call-meeting-row">
			<span className="call-meeting-label">
				<MonitorSpeaker size={14} aria-hidden="true" />
				<span>{messages.assistant.live.includeMeetingAudio}</span>
			</span>
			<button
				type="button"
				role="switch"
				aria-label={messages.assistant.live.includeMeetingAudio}
				aria-checked={includeMeetingAudio}
				className="demo-switch"
				disabled={toggleDisabled}
				onClick={onToggleMeetingAudio}
			>
				<span className="demo-switch-thumb" aria-hidden="true" />
			</button>
		</div>
	)
}
