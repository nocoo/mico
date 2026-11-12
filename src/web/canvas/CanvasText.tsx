import type React from 'react'
import { useLayoutEffect, useRef } from 'react'
import type { CanvasShape } from '../../shared/types'
import { canvasTextColor, FONT_STACKS } from '../design'
import './canvas-text.css'

export function CanvasText({ shape, editing }: { shape: CanvasShape; editing: boolean }) {
	const textRef = useRef<HTMLDivElement>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: rendered dimensions and typography invalidate DOM measurement
	useLayoutEffect(() => {
		const element = textRef.current
		if (!element) return
		element.style.lineHeight = '1.5'
		element.style.overflow = 'hidden'
		if (element.scrollHeight <= element.clientHeight) return
		element.style.lineHeight = '1.15'
		element.style.overflow = element.scrollHeight <= element.clientHeight ? 'hidden' : 'visible'
	}, [shape.font, shape.fontSize, shape.fontWeight, shape.h, shape.text, shape.w])

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
			<foreignObject
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				overflow="visible"
				pointerEvents="none"
			>
				<div
					ref={textRef}
					className={editing ? 'canvas-text canvas-text-editing' : 'canvas-text'}
					style={style}
				>
					{shape.text || 'Type something'}
				</div>
			</foreignObject>
		</>
	)
}
