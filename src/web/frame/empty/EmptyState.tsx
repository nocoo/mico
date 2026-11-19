import { Play } from 'lucide-react'
import { useI18n } from '../../i18n'
import './empty.css'

interface EmptyStateProps {
	onOpenAssistant: () => void
	onDismiss: () => void
}

export function EmptyState({ onOpenAssistant, onDismiss }: EmptyStateProps) {
	const { messages } = useI18n()
	return (
		<section className="frame-empty" aria-label={messages.emptyState.regionLabel}>
			<div className="frame-empty-orb" aria-hidden="true">
				<i />
				<i />
				<i />
			</div>
			<h1>{messages.emptyState.heading}</h1>
			<p>{messages.emptyState.subheading}</p>
			<div className="frame-empty-actions">
				<button type="button" className="frame-empty-primary" onClick={onOpenAssistant}>
					<Play size={18} aria-hidden="true" />
					{messages.emptyState.openAssistant}
				</button>
				<button type="button" onClick={onDismiss}>
					{messages.emptyState.dismiss}
				</button>
			</div>
			<div className="frame-empty-hint">{messages.emptyState.eyebrow}</div>
		</section>
	)
}
