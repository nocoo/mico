import type React from 'react'
import type { CanvasShape } from '../../shared/types'
import { CANDY_COLORS, FONT_STACKS } from '../design'
import './canvas-text.css'

const REFERENCE_SANS_STACK =
	'"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", sans-serif'

export function CanvasText({ shape, editing }: { shape: CanvasShape; editing: boolean }) {
	if (shape.type !== 'text') return null

	const font = shape.font ?? 'sans'
	const style = {
		fontFamily: font === 'sans' ? REFERENCE_SANS_STACK : FONT_STACKS[font],
		fontSize: `${shape.fontSize ?? 32}px`,
		fontWeight: shape.fontWeight ?? 500,
		color: shape.color === CANDY_COLORS.ink ? 'var(--ui-ink)' : shape.color,
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
					{shape.text ?? ''}
				</div>
			</foreignObject>
		</>
	)
}
