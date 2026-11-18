import { Mic, Phone, Presentation, Video } from 'lucide-react'
import { type MeetingPresence, type MeetingViewModel, meetingPreview } from './viewmodel'
import './meeting.css'

export function MeetingView({ model }: { model: MeetingViewModel }) {
	return (
		<section className="meeting-frame" aria-label={`${model.title}, not connected`}>
			<div className="meeting-clock">
				<span className="sr-only">Preview time</span>
				<span className="meeting-clock-dot" aria-hidden="true" />
				<time>{model.elapsed}</time>
			</div>
			<div className="meeting-title">
				<b>{model.title}</b>
				<span>{model.detail}</span>
			</div>
			<div className="meeting-avatars">
				<span className="sr-only">{model.title}</span>
				{model.participants.map((participant) => (
					<span
						key={participant.id ?? participant.name}
						className="meeting-avatar"
						role="img"
						data-color={participant.color}
						data-presenter={participant.presenter || undefined}
						title={`${participant.name}${participant.self ? ' (you)' : ''} · ${participant.id ? (participant.presenter ? 'presenter' : 'participant') : 'example'}`}
						aria-label={`${participant.name}, ${participant.self ? 'you, ' : ''}${participant.id ? (participant.presenter ? 'presenter' : 'participant') : 'example'}`}
					>
						{participant.initial}
						{participant.presenter && (
							<span className="meeting-presenter-badge" aria-hidden="true">
								<Presentation />
							</span>
						)}
					</span>
				))}
			</div>
			<span className="meeting-divider" aria-hidden="true" />
			<button
				type="button"
				className="meeting-button"
				aria-label="Microphone unavailable in preview"
				disabled={!model.controlsEnabled}
			>
				<Mic aria-hidden="true" />
			</button>
			<button
				type="button"
				className="meeting-button"
				aria-label="Camera unavailable in preview"
				disabled={!model.controlsEnabled}
			>
				<Video aria-hidden="true" />
			</button>
			<button
				type="button"
				className="meeting-button meeting-leave"
				aria-label="Leave meeting unavailable in preview"
				disabled={!model.controlsEnabled}
			>
				<Phone aria-hidden="true" />
			</button>
		</section>
	)
}

export function MeetingFrame({ presence }: { presence?: MeetingPresence }) {
	return <MeetingView model={meetingPreview(presence)} />
}
