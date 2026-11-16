import type { CSSProperties } from 'react'
import type { WhiteboardMember, WhiteboardSession } from '../../shared/whiteboards'

export function WhiteboardPresence({
	session,
	members,
	following,
	presenterId,
	connected,
	error,
	onFollow,
	zoom,
	onZoom,
}: {
	session: WhiteboardSession
	members: WhiteboardMember[]
	following: boolean
	presenterId: string | null
	connected: boolean
	error: string
	onFollow: () => void
	zoom: number
	onZoom: (factor: number) => void
}) {
	return (
		<>
			<header className="whiteboard-presence">
				<div className="whiteboard-presence-heading">
					<a href="/?whiteboards=1">Whiteboards</a>
					<span>{session.member.sharer ? 'Presenting' : 'View only'}</span>
					<small role="status">{connected ? 'Live' : 'Reconnecting…'}</small>
				</div>
				<ul className="whiteboard-members" aria-label="People on this whiteboard">
					{members.map((member) => (
						<li
							className="whiteboard-member"
							data-member-id={member.id}
							key={member.id}
							style={{ backgroundColor: member.color }}
							title={`${member.username}${member.sharer ? ' · Presenter' : ''}`}
						>
							{member.username}
							{member.sharer ? ' · Presenter' : ''}
						</li>
					))}
				</ul>
				{error && (
					<p role="alert">
						{error}{' '}
						<button type="button" onClick={() => window.location.reload()}>
							Rejoin
						</button>
					</p>
				)}
			</header>
			{!session.member.sharer && (
				<>
					{!following && <div className="whiteboard-detached-frame" aria-hidden="true" />}
					<div className="whiteboard-view-controls">
						<span role="status">
							{!connected
								? 'Connection lost'
								: !presenterId
									? 'Waiting for presenter'
									: following
										? 'Following presenter'
										: 'Exploring independently'}
						</span>
						{!following && (
							<button type="button" onClick={onFollow} disabled={!connected || !presenterId}>
								回到演示者视角
							</button>
						)}
						<div className="whiteboard-zoom">
							<button type="button" aria-label="Zoom out" onClick={() => onZoom(1 / 1.2)}>
								−
							</button>
							<span>{Math.round(zoom * 100)}%</span>
							<button type="button" aria-label="Zoom in" onClick={() => onZoom(1.2)}>
								+
							</button>
						</div>
					</div>
				</>
			)}
		</>
	)
}

export function WhiteboardCursors({
	session,
	members,
	viewport,
}: {
	session: WhiteboardSession
	members: WhiteboardMember[]
	viewport: { x: number; y: number; zoom: number }
}) {
	return (
		<div className="whiteboard-cursors" aria-hidden="true">
			{members
				.filter((member) => member.id !== session.member.id && member.cursor)
				.map((member) => {
					if (!member.cursor) return null
					return (
						<div
							className="whiteboard-cursor"
							data-cursor-id={member.id}
							key={member.id}
							style={
								{
									'--member-color': member.color,
									transform: `translate(${viewport.x + member.cursor.x * viewport.zoom}px, ${viewport.y + member.cursor.y * viewport.zoom}px)`,
								} as CSSProperties
							}
						>
							<svg width="20" height="25" viewBox="0 0 20 25">
								<title>{member.username}</title>
								<path d="M1 1L18 15L10 16L6 23Z" />
							</svg>
							<span>{member.username}</span>
						</div>
					)
				})}
		</div>
	)
}
