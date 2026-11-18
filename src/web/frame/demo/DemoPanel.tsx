import { Popover } from '@radix-ui/themes'
import { Sparkles, UserRound, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import packageJson from '../../../../package.json' with { type: 'json' }
import type { WhiteboardMember } from '../../../shared/whiteboards'
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
	following: boolean
	ephemeral: boolean
	aiEnabled: boolean
	onUpdateProfile: (username: string, sharer: boolean) => Promise<void>
	onFollowPresenter: () => void
	onRequestPresenter?: (requested: boolean) => void
	onTransferPresenter?: (targetMemberId: string) => void
	onDeclinePresenter?: (targetMemberId: string) => void
	canvasAccess?: {
		name: string
		editorIds: string[]
		onChange: (participantId: string, allowed: boolean) => void
	}
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
	following,
	ephemeral,
	aiEnabled,
	onUpdateProfile,
	onFollowPresenter,
	onRequestPresenter,
	onTransferPresenter,
	onDeclinePresenter,
	canvasAccess,
}: DemoPanelProps) {
	const [draftName, setDraftName] = useState(username)
	const presenterLabelId = useId()

	useEffect(() => {
		setDraftName(username)
	}, [username])

	const firstCharacter = username.trim().codePointAt(0)
	const fallback = firstCharacter ? String.fromCodePoint(firstCharacter).toLocaleUpperCase() : null
	const otherPresenter = Boolean(presenterId && presenterId !== selfId)
	const selfRequested = Boolean(selfId && requesterIds.includes(selfId))
	const selfParticipantId = members.find((member) => member.id === selfId)?.participantId
	const canEditCanvas =
		sharer || Boolean(selfParticipantId && canvasAccess?.editorIds.includes(selfParticipantId))

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
					aria-label="Workspace profile"
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
				aria-label="Workspace profile"
				data-demo-panel="true"
				side="bottom"
				align="start"
				sideOffset={8}
				collisionPadding={14}
			>
				<header className="debug-panel-header">
					<span className="debug-panel-title">Demo profile</span>
					<Popover.Close>
						<button type="button" className="debug-close" aria-label="Close profile">
							<X aria-hidden="true" />
						</button>
					</Popover.Close>
				</header>
				<div className="debug-panel-content">
					<form className="demo-panel-form" onSubmit={submitName}>
						<label className="demo-field">
							<span>Your name</span>
							<div className="demo-name-row">
								<input
									className="demo-name-input"
									type="text"
									maxLength={80}
									value={draftName}
									onChange={(event) => setDraftName(event.target.value)}
									placeholder="Enter your name"
								/>
								<button
									type="submit"
									className="demo-name-save"
									disabled={busy || !draftName.trim() || draftName.trim() === username}
								>
									Save
								</button>
							</div>
						</label>
						{otherPresenter ? (
							<div className="demo-presenter-toggle">
								<span>Presenter</span>
								{onRequestPresenter && (
									<button
										type="button"
										className="demo-secondary-btn"
										disabled={busy}
										onClick={() => onRequestPresenter(!selfRequested)}
									>
										{selfRequested ? 'Cancel request' : 'Request presenter'}
									</button>
								)}
							</div>
						) : (
							<div className="demo-presenter-toggle">
								<span id={presenterLabelId}>Presenter</span>
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
						<section className="demo-members" aria-label="Online members">
							<div className="demo-members-header">
								<span>Online ({members.length})</span>
								{otherPresenter && !following && (
									<button type="button" className="demo-follow-button" onClick={onFollowPresenter}>
										Follow presenter
									</button>
								)}
							</div>
							<ul className="demo-members-list">
								{members.map((member) => {
									const isRequester = requesterIds.includes(member.id)
									const participantId = member.participantId
									const hasCanvasAccess = Boolean(
										participantId && canvasAccess?.editorIds.includes(participantId),
									)
									return (
										<li key={member.id} className="demo-member-item">
											<span
												className="demo-member-dot"
												style={{ background: member.color }}
												aria-hidden="true"
											/>
											<span className="demo-member-name">
												{member.username}
												{member.id === selfId ? ' (you)' : ''}
											</span>
											<span className="demo-member-actions">
												{canvasAccess &&
													sharer &&
													participantId &&
													member.id !== selfId &&
													!member.sharer && (
														<button
															type="button"
															className="demo-member-btn"
															aria-label={`${hasCanvasAccess ? 'Revoke edit access from' : 'Grant edit access to'} ${member.username}`}
															onClick={() => canvasAccess.onChange(participantId, !hasCanvasAccess)}
														>
															{hasCanvasAccess ? 'Revoke edit' : 'Grant edit'}
														</button>
													)}
												{member.sharer && <span className="demo-member-badge">Presenter</span>}
												{!member.sharer && isRequester && (
													<span className="demo-member-badge demo-member-badge--request">
														Requested
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
																Approve
															</button>
															<button
																type="button"
																className="demo-member-btn"
																onClick={() => onDeclinePresenter?.(member.id)}
															>
																Decline
															</button>
														</>
													) : (
														<button
															type="button"
															className="demo-member-btn"
															onClick={() => onTransferPresenter?.(member.id)}
														>
															Transfer
														</button>
													))}
											</span>
										</li>
									)
								})}
							</ul>
						</section>
					)}
					{canvasAccess && (
						<section className="debug-row" aria-label="Canvas edit access">
							<span className="debug-row-copy">
								<strong>
									{canvasAccess.name}: {canEditCanvas ? 'Edit all objects' : 'Own objects only'}
								</strong>
								<span>Presenter grants apply only to this canvas, until revoked.</span>
								{sharer &&
									canvasAccess.editorIds
										.filter((id) => !members.some((member) => member.participantId === id))
										.map((id) => (
											<button
												key={id}
												type="button"
												className="demo-member-btn"
												onClick={() => canvasAccess.onChange(id, false)}
											>
												Revoke edit: offline participant {id.slice(0, 8)}
											</button>
										))}
							</span>
						</section>
					)}
					{ephemeral && (
						<section className="debug-row" aria-label="Preview status">
							<strong>Preview</strong>
							<span>Data may disappear</span>
						</section>
					)}
					<section className="debug-row" aria-label="AI availability">
						<span
							className={`debug-status-icon ${aiEnabled && sharer ? 'enabled' : 'unavailable'}`}
						>
							<Sparkles aria-hidden="true" />
						</span>
						<span className="debug-row-copy">
							<strong>
								{!aiEnabled ? 'AI unavailable' : sharer ? 'AI enabled' : 'AI (Presenter only)'}
							</strong>
							{(!aiEnabled || !sharer) && (
								<span>
									{aiEnabled ? 'Become presenter to use AI' : 'Manual drawing is available'}
								</span>
							)}
						</span>
					</section>
					<section className="debug-version">Version v{packageJson.version}</section>
				</div>
			</Popover.Content>
		</Popover.Root>
	)
}
