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
							<svg width="20" height="22" viewBox="0 0 22 24">
								<title>{member.username}</title>
								<path d="M4.2 3.1C3.4 2.4 2.2 3.1 2.5 4.1L5.8 18.7C6.1 19.7 7.4 20.0 8.1 19.1L11.2 15.0L16.3 14.3C17.4 14.1 17.8 12.8 16.9 12.1L4.2 3.1Z" />
							</svg>
							<span>{member.username}</span>
						</div>
					)
				})}
		</div>
	)
}
