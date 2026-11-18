import type { CSSProperties } from 'react'
import type { CanvasShape, Shape } from '../../shared/types'
import type { WhiteboardMember, WhiteboardSession } from '../../shared/whiteboards'
import { getConnectorVisualBounds } from '../canvas/connectorGeometry'
import { shapeBounds } from '../selection'

const isCanvasShape = (shape: Shape): shape is CanvasShape => shape.type !== 'connector'

function boundsForShape(shape: Shape, shapeById?: ReadonlyMap<string, Shape>) {
	if (shape.type === 'connector') {
		const from = shapeById?.get(shape.from)
		const to = shapeById?.get(shape.to)
		if (!from || !to || !isCanvasShape(from) || !isCanvasShape(to)) return null
		const bounds = getConnectorVisualBounds(shape, from, to)
		return bounds
			? {
					x: bounds.left,
					y: bounds.top,
					w: bounds.right - bounds.left,
					h: bounds.bottom - bounds.top,
				}
			: null
	}
	return shapeBounds(shape)
}

export function WhiteboardCursors({
	session,
	members,
	viewport,
	shapeById,
}: {
	session: WhiteboardSession
	members: WhiteboardMember[]
	viewport: { x: number; y: number; zoom: number }
	shapeById?: ReadonlyMap<string, Shape>
}) {
	return (
		<div className="whiteboard-cursors" aria-hidden="true">
			{shapeById &&
				members
					.filter((member) => member.id !== session.member.id && member.selectedIds?.length)
					.flatMap((member) =>
						(member.selectedIds ?? []).map((shapeId) => {
							const shape = shapeById.get(shapeId)
							if (!shape) return null
							const bounds = boundsForShape(shape, shapeById)
							if (!bounds) return null
							const pad = 4
							const left = viewport.x + bounds.x * viewport.zoom - pad
							const top = viewport.y + bounds.y * viewport.zoom - pad
							const width = Math.max(8, bounds.w * viewport.zoom + pad * 2)
							const height = Math.max(8, bounds.h * viewport.zoom + pad * 2)
							return (
								<div
									key={`${member.id}:${shapeId}`}
									className="whiteboard-remote-selection"
									data-member-id={member.id}
									data-shape-id={shapeId}
									style={
										{
											'--member-color': member.color,
											width: `${width}px`,
											height: `${height}px`,
											transform: `translate(${left}px, ${top}px)`,
										} as CSSProperties
									}
								>
									<span>{member.username}</span>
								</div>
							)
						}),
					)}
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
