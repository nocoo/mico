import type React from 'react'
import type { CanvasShape } from '../../shared/types'
import { canvasTextColor, FONT_STACKS } from '../design'
import './canvas-text.css'

export function CanvasText({ shape, editing }: { shape: CanvasShape; editing: boolean }) {
	if (shape.type !== 'text') return null

	const font = shape.font ?? 'sans'
	const style = {
		fontFamily: FONT_STACKS[font],
		fontSize: `${shape.fontSize ?? 32}px`,
		fontWeight: shape.fontWeight ?? 500,
		color: canvasTextColor(shape.color),
	} satisfies React.CSSProperties

	return (
		<>
			<rect
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				fill="transparent"
				pointerEvents="all"
			/>
			<foreignObject x={shape.x} y={shape.y} width={shape.w} height={shape.h} pointerEvents="none">
				<div className={editing ? 'canvas-text canvas-text-editing' : 'canvas-text'} style={style}>
					{shape.text || 'Type something'}
				</div>
			</foreignObject>
		</>
	)
}
