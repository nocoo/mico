import { Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WhiteboardMember } from '../../../shared/whiteboards'
import { useI18n } from '../../i18n'

const DEFAULT_DURATION_MS = 20_000
const EXIT_ANIMATION_MS = 220

export interface PresenterRequestDialogProps {
	readonly active: boolean
	readonly members: readonly WhiteboardMember[]
	readonly requesterIds: readonly string[]
	readonly selfId: string | null
	readonly onApprove: (memberId: string) => void
	readonly onDecline: (memberId: string) => void
	readonly durationMs?: number
}

export function PresenterRequestDialog({
	active,
	members,
	requesterIds,
	selfId,
	onApprove,
	onDecline,
	durationMs = DEFAULT_DURATION_MS,
}: PresenterRequestDialogProps) {
	const { messages } = useI18n()
	const requesters = useMemo(() => {
		const memberMap = new Map(members.map((member) => [member.id, member]))
		const list: WhiteboardMember[] = []
		for (const id of requesterIds) {
			if (id === selfId) continue
			const member = memberMap.get(id)
			if (member && !member.sharer) list.push(member)
		}
		return list
	}, [members, requesterIds, selfId])

	const [dismissed, setDismissed] = useState(false)
	const [closing, setClosing] = useState(false)
	const [cycle, setCycle] = useState(0)
	const [remainingSeconds, setRemainingSeconds] = useState(() => Math.ceil(durationMs / 1000))
	const prevIdsRef = useRef<Set<string>>(new Set())
	const deadlineRef = useRef<number>(0)

	useEffect(() => {
		if (!active || requesters.length === 0) {
			prevIdsRef.current = new Set()
			setDismissed(false)
			setClosing(false)
			return
		}
		const currentIds = new Set(requesters.map((member) => member.id))
		let hasNewRequester = false
		for (const id of currentIds) {
			if (!prevIdsRef.current.has(id)) {
				hasNewRequester = true
				break
			}
		}
		prevIdsRef.current = currentIds
		if (hasNewRequester) {
			deadlineRef.current = Date.now() + durationMs
			setDismissed(false)
			setClosing(false)
			setRemainingSeconds(Math.ceil(durationMs / 1000))
			setCycle((prev) => prev + 1)
		}
	}, [active, requesters, durationMs])

	const visible = active && requesters.length > 0 && !dismissed

	useEffect(() => {
		if (!visible || closing) return
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
	}, [visible, closing])

	useEffect(() => {
		if (!closing) return
		const timer = window.setTimeout(() => {
			setDismissed(true)
			setClosing(false)
		}, EXIT_ANIMATION_MS)
		return () => window.clearTimeout(timer)
	}, [closing])

	if (!visible) return null

	return (
		<aside
			className={`presenter-request-dialog${closing ? ' is-closing' : ''}`}
			role="dialog"
			aria-label={messages.demo.requestTitlePlural(requesters.length)}
			aria-live="polite"
		>
			<div className="presenter-request-header">
				<span className="presenter-request-title-group">
					<span className="presenter-request-icon" aria-hidden="true">
						<Sparkles size={14} />
					</span>
					<span className="presenter-request-title">
						{requesters.length === 1
							? messages.demo.requestTitleSingle
							: messages.demo.requestTitlePlural(requesters.length)}
					</span>
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
						aria-label={messages.demo.ignoreRequests}
						onClick={() => setClosing(true)}
					>
						<X size={14} aria-hidden="true" />
					</button>
				</span>
			</div>

			<ul className="presenter-request-list">
				{requesters.map((member) => (
					<li key={member.id} className="presenter-request-item">
						<span
							className="demo-member-dot"
							style={{ background: member.color }}
							aria-hidden="true"
						/>
						<span className="presenter-request-name">{member.username}</span>
						<span className="presenter-request-actions">
							<button
								type="button"
								className="demo-member-btn demo-member-btn--primary"
								onClick={() => onApprove(member.id)}
							>
								{messages.demo.approve}
							</button>
							<button
								type="button"
								className="demo-member-btn"
								onClick={() => onDecline(member.id)}
							>
								{messages.demo.decline}
							</button>
						</span>
					</li>
				))}
			</ul>

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
