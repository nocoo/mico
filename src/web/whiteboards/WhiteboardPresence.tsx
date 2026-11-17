import type { CSSProperties } from 'react'
import type { WhiteboardMember, WhiteboardSession } from '../../shared/whiteboards'

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
