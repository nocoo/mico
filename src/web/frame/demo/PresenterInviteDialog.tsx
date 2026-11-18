import { Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PresenterInvite, WhiteboardMember } from '../../../shared/whiteboards'
import { useI18n } from '../../i18n'

const DEFAULT_DURATION_MS = 20_000
const EXIT_ANIMATION_MS = 220

export interface PresenterInviteDialogProps {
	readonly active: boolean
	readonly invite: PresenterInvite | null
	readonly members: readonly WhiteboardMember[]
	readonly selfId: string | null
	readonly onRespond: (accept: boolean) => void
	readonly durationMs?: number
}

export function PresenterInviteDialog({
	active,
	invite,
	members,
	selfId,
	onRespond,
	durationMs = DEFAULT_DURATION_MS,
}: PresenterInviteDialogProps) {
	const { messages } = useI18n()
	const isTarget = Boolean(active && invite && selfId && invite.targetMemberId === selfId)
	const inviter = useMemo(
		() => (invite ? members.find((member) => member.id === invite.fromMemberId) : undefined),
		[invite, members],
	)

	const [closing, setClosing] = useState(false)
	const [cycle, setCycle] = useState(0)
	const [remainingSeconds, setRemainingSeconds] = useState(() => Math.ceil(durationMs / 1000))
	const activeInviteKeyRef = useRef<string | null>(null)
	const deadlineRef = useRef<number>(0)
	const onRespondRef = useRef(onRespond)
	onRespondRef.current = onRespond

	useEffect(() => {
		if (!isTarget || !invite) {
			activeInviteKeyRef.current = null
			setClosing(false)
			return
		}
		const key = `${invite.fromMemberId}:${invite.targetMemberId}`
		if (activeInviteKeyRef.current !== key) {
			activeInviteKeyRef.current = key
			deadlineRef.current = Date.now() + durationMs
			setClosing(false)
			setRemainingSeconds(Math.ceil(durationMs / 1000))
			setCycle((prev) => prev + 1)
		}
	}, [isTarget, invite, durationMs])

	useEffect(() => {
		if (!isTarget || closing) return
		const tick = window.setInterval(() => {
			const leftMs = deadlineRef.current - Date.now()
			if (leftMs <= 0) {
				setRemainingSeconds(0)
				setClosing(true)
				window.clearInterval(tick)
				return
			}
			setRemainingSeconds(Math.ceil(leftMs / 1000))
		}, 200)
		return () => window.clearInterval(tick)
	}, [isTarget, closing])

	useEffect(() => {
		if (!closing) return
		const timer = window.setTimeout(() => {
			onRespondRef.current(false)
		}, EXIT_ANIMATION_MS)
		return () => window.clearTimeout(timer)
	}, [closing])

	if (!isTarget || !invite) return null

	return (
		<aside
			className={`presenter-request-dialog${closing ? ' is-closing' : ''}`}
			role="dialog"
			aria-label={messages.demo.inviteTitle}
			aria-live="polite"
		>
			<div className="presenter-request-header">
				<span className="presenter-request-title-group">
					<span className="presenter-request-icon" aria-hidden="true">
						<Sparkles size={14} />
					</span>
					<span className="presenter-request-title">{messages.demo.inviteTitle}</span>
				</span>
				<span className="presenter-request-meta">
					<span
						className="presenter-request-timer"
						title={messages.demo.secondsLeft(remainingSeconds)}
					>
						{remainingSeconds}s
					</span>
					<button
						type="button"
						className="presenter-request-dismiss"
						aria-label={messages.demo.declineInvite}
						onClick={() => setClosing(true)}
					>
						<X size={14} aria-hidden="true" />
					</button>
				</span>
			</div>

			<div className="presenter-request-item">
				<span
					className="demo-member-dot"
					style={{ background: inviter?.color ?? '#00a2e1' }}
					aria-hidden="true"
				/>
				<span className="presenter-request-name">
					{inviter ? messages.demo.invitePrompt(inviter.username) : messages.demo.inviteFallback}
				</span>
				<span className="presenter-request-actions">
					<button
						type="button"
						className="demo-member-btn demo-member-btn--primary"
						onClick={() => onRespond(true)}
					>
						{messages.demo.accept}
					</button>
					<button type="button" className="demo-member-btn" onClick={() => setClosing(true)}>
						{messages.demo.decline}
					</button>
				</span>
			</div>

			<div className="presenter-request-progress-track" aria-hidden="true">
				<div
					key={cycle}
					className="presenter-request-progress-bar"
					style={{ animationDuration: `${durationMs}ms` }}
				/>
			</div>
		</aside>
	)
}
