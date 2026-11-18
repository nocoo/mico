import { Popover } from '@radix-ui/themes'
import { Sparkles, UserRound, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import packageJson from '../../../../package.json' with { type: 'json' }
import type { WhiteboardMember } from '../../../shared/whiteboards'
import { useI18n } from '../../i18n'
import '../debug/debug.css'
import './demo.css'

export interface DemoPanelProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	username: string
	sharer: boolean
	busy: boolean
	error: string
	members: WhiteboardMember[]
	presenterId: string | null
	selfId: string | null
	requesterIds?: string[]
	invitedMemberId?: string | null
	following: boolean
	ephemeral: boolean
	aiEnabled: boolean
	onUpdateProfile: (username: string, sharer: boolean) => Promise<void>
	onFollowPresenter: () => void
	onRequestPresenter?: (requested: boolean) => void
	onTransferPresenter?: (targetMemberId: string) => void
	onDeclinePresenter?: (targetMemberId: string) => void
	onInvitePresenter?: (targetMemberId: string) => void
}

export function DemoPanel({
	open,
	onOpenChange,
	username,
	sharer,
	busy,
	error,
	members,
	presenterId,
	selfId,
	requesterIds = [],
	invitedMemberId = null,
	following,
	ephemeral,
	aiEnabled,
	onUpdateProfile,
	onFollowPresenter,
	onRequestPresenter,
	onTransferPresenter,
	onDeclinePresenter,
	onInvitePresenter,
}: DemoPanelProps) {
	const { messages, preference, setPreference } = useI18n()
	const [draftName, setDraftName] = useState(username)
	const presenterLabelId = useId()

	useEffect(() => {
		setDraftName(username)
	}, [username])

	const firstCharacter = username.trim().codePointAt(0)
	const fallback = firstCharacter ? String.fromCodePoint(firstCharacter).toLocaleUpperCase() : null
	const otherPresenter = Boolean(presenterId && presenterId !== selfId)
	const selfRequested = Boolean(selfId && requesterIds.includes(selfId))

	const submitName = (event: React.FormEvent) => {
		event.preventDefault()
		const trimmed = draftName.trim()
		if (!trimmed || busy) return
		void onUpdateProfile(trimmed, sharer)
	}

	const toggleSharer = (nextSharer: boolean) => {
		if (busy) return
		const trimmed = draftName.trim() || username
		void onUpdateProfile(trimmed, nextSharer)
	}

	return (
		<Popover.Root open={open} onOpenChange={onOpenChange}>
			<Popover.Trigger>
				<button
					type="button"
					className="debug-trigger frame-identity"
					aria-label={messages.identity.workspaceProfile}
					aria-expanded={open}
					aria-controls="demo-panel"
					data-demo-toggle="true"
					title={username}
				>
					<span className="debug-avatar debug-avatar-trigger" aria-hidden="true">
						{fallback ? <span>{fallback}</span> : <UserRound />}
					</span>
				</button>
			</Popover.Trigger>
			<Popover.Content
				id="demo-panel"
				className="debug-panel frame-identity identity-surface"
				aria-label={messages.identity.workspaceProfile}
				data-demo-panel="true"
				side="bottom"
				align="start"
				sideOffset={8}
				collisionPadding={14}
			>
				<header className="debug-panel-header">
					<span className="debug-panel-title">{messages.demo.profileTitle}</span>
					<Popover.Close>
						<button
							type="button"
							className="debug-close"
							aria-label={messages.identity.closeProfile}
						>
							<X aria-hidden="true" />
						</button>
					</Popover.Close>
				</header>
				<div className="debug-panel-content">
					<form className="demo-panel-form demo-card" onSubmit={submitName}>
						<label className="demo-field">
							<span>{messages.demo.yourName}</span>
							<div className="demo-name-row">
								<input
									className="demo-name-input"
									type="text"
									maxLength={80}
									value={draftName}
									onChange={(event) => setDraftName(event.target.value)}
									placeholder={messages.demo.enterName}
								/>
								<button
									type="submit"
									className="demo-name-save"
									disabled={busy || !draftName.trim() || draftName.trim() === username}
								>
									{messages.common.save}
								</button>
							</div>
						</label>
						{otherPresenter ? (
							<div className="demo-presenter-toggle">
								<span>{messages.demo.presenter}</span>
								{onRequestPresenter && (
									<button
										type="button"
										className="demo-secondary-btn"
										disabled={busy}
										onClick={() => onRequestPresenter(!selfRequested)}
									>
										{selfRequested ? messages.demo.cancelRequest : messages.demo.requestPresenter}
									</button>
								)}
							</div>
						) : (
							<div className="demo-presenter-toggle">
								<span id={presenterLabelId}>{messages.demo.presenter}</span>
								<button
									type="button"
									role="switch"
									aria-labelledby={presenterLabelId}
									aria-checked={sharer}
									className="demo-switch"
									disabled={busy}
									onClick={() => toggleSharer(!sharer)}
								>
									<span className="demo-switch-thumb" aria-hidden="true" />
								</button>
							</div>
						)}
						{error && (
							<p className="demo-error" role="alert">
								{error}
							</p>
						)}
					</form>
					{members.length > 0 && (
						<section className="demo-members demo-card" aria-label="Online members">
							<div className="demo-members-header">
								<span>{messages.demo.onlineMembers(members.length)}</span>
								{otherPresenter && !following && (
									<button type="button" className="demo-follow-button" onClick={onFollowPresenter}>
										{messages.demo.followPresenter}
									</button>
								)}
							</div>
							<ul className="demo-members-list">
								{members.map((member) => {
									const isRequester = requesterIds.includes(member.id)
									return (
										<li key={member.id} className="demo-member-item">
											<span
												className="demo-member-dot"
												style={{ background: member.color }}
												aria-hidden="true"
											/>
											<span className="demo-member-name">
												{member.username}
												{member.id === selfId ? ` (${messages.common.you})` : ''}
											</span>
											<span className="demo-member-actions">
												{member.sharer && (
													<span className="demo-member-badge">{messages.demo.badgePresenter}</span>
												)}
												{!member.sharer && isRequester && (
													<span className="demo-member-badge demo-member-badge--request">
														{messages.demo.badgeRequested}
													</span>
												)}
												{sharer &&
													member.id !== selfId &&
													(isRequester ? (
														<>
															<button
																type="button"
																className="demo-member-btn demo-member-btn--primary"
																onClick={() => onTransferPresenter?.(member.id)}
															>
																{messages.demo.approve}
															</button>
															<button
																type="button"
																className="demo-member-btn"
																onClick={() => onDeclinePresenter?.(member.id)}
															>
																{messages.demo.decline}
															</button>
														</>
													) : invitedMemberId === member.id ? (
														<span className="demo-member-badge demo-member-badge--request">
															{messages.demo.badgeInvited}
														</span>
													) : (
														<button
															type="button"
															className="demo-member-btn"
															onClick={() =>
																(onInvitePresenter ?? onTransferPresenter)?.(member.id)
															}
														>
															{messages.demo.transfer}
														</button>
													))}
											</span>
										</li>
									)
								})}
							</ul>
						</section>
					)}
					{ephemeral && (
						<section className="debug-row" aria-label={messages.identity.previewStatus}>
							<strong>{messages.identity.previewStatus}</strong>
							<span>{messages.identity.previewDisappear}</span>
						</section>
					)}
					<section className="debug-row" aria-label={messages.identity.aiAvailable}>
						<span
							className={`debug-status-icon ${aiEnabled && sharer ? 'enabled' : 'unavailable'}`}
						>
							<Sparkles aria-hidden="true" />
						</span>
						<span className="debug-row-copy">
							<strong>
								{!aiEnabled
									? messages.identity.aiUnavailable
									: sharer
										? messages.identity.aiAvailable
										: messages.identity.aiPresenterOnly}
							</strong>
							{(!aiEnabled || !sharer) && (
								<span>
									{aiEnabled
										? messages.identity.aiPresenterHint
										: messages.identity.aiNotConfigured}
								</span>
							)}
						</span>
					</section>
					<section className="debug-row" aria-label={messages.common.language}>
						<strong>{messages.common.language}</strong>
						<div className="demo-lang-group">
							{(['auto', 'en', 'zh'] as const).map((pref) => (
								<button
									key={pref}
									type="button"
									className={`demo-member-btn${preference === pref ? ' demo-member-btn--primary' : ''}`}
									onClick={() => setPreference(pref)}
								>
									{pref === 'auto'
										? messages.common.languageAuto
										: pref === 'en'
											? messages.common.languageEn
											: messages.common.languageZh}
								</button>
							))}
						</div>
					</section>
					<section className="debug-version">
						{messages.identity.version} v{packageJson.version}
					</section>
				</div>
			</Popover.Content>
		</Popover.Root>
	)
}
