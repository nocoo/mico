import { Mic, Phone, Video } from 'lucide-react'
import { type MeetingViewModel, meetingPreview } from './viewmodel'
import './meeting.css'

export function MeetingView({ model }: { model: MeetingViewModel }) {
	return (
		<section className="meeting-frame" aria-label="Meeting preview, not connected">
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
				<span className="sr-only">Example participants</span>
				{model.participants.map((participant) => (
					<span
						key={participant.name}
						className="meeting-avatar"
						role="img"
						data-color={participant.color}
						title={`${participant.name} · example`}
						aria-label={`${participant.name}, example`}
					>
						{participant.initial}
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

export function MeetingFrame() {
	return <MeetingView model={meetingPreview()} />
}
