import type React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { CanvasShape } from '../../shared/types'
import './html-card.css'

interface HtmlCardLabelProps {
	shape: CanvasShape
	onPointerDown: (event: React.PointerEvent<SVGGElement>) => void
	onDoubleClick: (event: React.MouseEvent<SVGGElement>) => void
}

export function HtmlCardLabel({ shape, onPointerDown, onDoubleClick }: HtmlCardLabelProps) {
	const pillRef = useRef<HTMLDivElement>(null)
	const [hitBox, setHitBox] = useState({ width: 0, height: 0 })
	const maxWidth = Math.max(160, Math.min(shape.w - 40, 360))
	const x = shape.x + 20

	useLayoutEffect(() => {
		const pill = pillRef.current
		if (!pill) return
		const measure = () =>
			setHitBox({
				width: Math.min(maxWidth, pill.offsetWidth),
				height: pill.offsetHeight,
			})
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(pill)
		return () => observer.disconnect()
	}, [maxWidth])

	if (shape.type !== 'html') return null
	const handlers = { onPointerDown, onDoubleClick }

	return (
		<g className="html-card-label-handle" data-card-handle={shape.id} {...handlers}>
			<foreignObject x={x} y={shape.y - 40} width={maxWidth} height={40} pointerEvents="none">
				<div className="html-card-label card-tab card-pill" ref={pillRef}>
					<span className="html-card-label-icon" aria-hidden="true">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
						</svg>
					</span>
					<span className="card-pill-title">{shape.title ?? 'HTML card'}</span>
				</div>
			</foreignObject>
			{hitBox.width > 0 && hitBox.height > 0 && (
				<rect
					x={x}
					y={shape.y - 8 - hitBox.height}
					width={hitBox.width}
					height={hitBox.height}
					fill="transparent"
				/>
			)}
		</g>
	)
}
