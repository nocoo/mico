import { Mic, Phone, Presentation, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AuthMode } from '../../../shared/runtime'
import type { WhiteboardMember } from '../../../shared/whiteboards'
import { useI18n } from '../../i18n'
import { buildMeetingViewModel, type MeetingViewModel } from './viewmodel'
import './meeting.css'

export interface MeetingFrameProps {
	readonly presenceActive: boolean
	readonly authMode: AuthMode
	readonly canvasName: string
	readonly members: readonly WhiteboardMember[]
	readonly presenterId: string | null
	readonly selfId: string | null
	readonly selfName?: string
}

export function MeetingView({ model }: { model: MeetingViewModel }) {
	const { messages } = useI18n()
	return (
		<section className="meeting-frame" aria-label={messages.meeting.ariaLabel(model.detail)}>
			<div className="meeting-clock" data-live={model.liveDot ? 'true' : undefined}>
				<span className="sr-only">{messages.meeting.clockSr}</span>
				<span className="meeting-clock-dot" aria-hidden="true" />
				<time>{model.elapsed}</time>
			</div>
			<div className="meeting-title">
				<b>{model.title}</b>
				<span>{model.detail}</span>
			</div>
			<div className="meeting-avatars">
				<span className="sr-only">{messages.meeting.participantsSr}</span>
				{model.participants.map((participant) => (
					<span
						key={participant.id}
						className="meeting-avatar"
						role="img"
						style={{ background: participant.hexColor }}
						data-presenter={participant.presenter || undefined}
						title={
							participant.isSelf ? `${participant.name} (${messages.common.you})` : participant.name
						}
						aria-label={`${participant.name}, ${participant.self ? 'you, ' : ''}${participant.presenter ? 'presenter' : 'participant'}`}
					>
						{participant.initial}
						{participant.presenter && (
							<span className="meeting-presenter-badge" aria-hidden="true">
								<Presentation />
							</span>
						)}
					</span>
				))}
				{model.overflowCount > 0 && (
					<span className="meeting-avatar meeting-avatar-more" aria-hidden="true">
						+{model.overflowCount}
					</span>
				)}
			</div>
			<span className="meeting-divider" aria-hidden="true" />
			<button
				type="button"
				className="meeting-button"
				aria-label={messages.meeting.micUnavailable}
				disabled={!model.controlsEnabled}
			>
				<Mic aria-hidden="true" />
			</button>
			<button
				type="button"
				className="meeting-button"
				aria-label={messages.meeting.cameraUnavailable}
				disabled={!model.controlsEnabled}
			>
				<Video aria-hidden="true" />
			</button>
			<button
				type="button"
				className="meeting-button meeting-leave"
				aria-label={messages.meeting.leaveUnavailable}
				disabled={!model.controlsEnabled}
			>
				<Phone aria-hidden="true" />
			</button>
		</section>
	)
}

export function MeetingFrame(props: MeetingFrameProps) {
	const { messages } = useI18n()
	const [elapsedSeconds, setElapsedSeconds] = useState(0)

	useEffect(() => {
		if (!props.presenceActive) {
			setElapsedSeconds(0)
			return
		}
		const startedAt = Date.now()
		const timer = window.setInterval(() => {
			setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
		}, 1000)
		return () => window.clearInterval(timer)
	}, [props.presenceActive])

	const model = buildMeetingViewModel({
		...props,
		elapsedSeconds,
		messages,
	})
	return <MeetingView model={model} />
}
