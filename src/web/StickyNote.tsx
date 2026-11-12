import type { CanvasShape } from '../shared/types'
import { jellyStyle } from './canvas/jelly'
import './canvas/jelly.css'
import './sticky-note.css'

export function StickyNote({ shape, animate }: { shape: CanvasShape; animate: boolean }) {
	return (
		<g className={animate ? 'sticky-entry' : undefined}>
			<rect
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				fill="transparent"
				pointerEvents="all"
			/>
			<foreignObject
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				overflow="visible"
				pointerEvents="none"
			>
				<div className="sticky-jelly canvas-jelly" style={jellyStyle(shape.color)}>
					<div className="sticky-body">{shape.text || ''}</div>
				</div>
			</foreignObject>
		</g>
	)
}
