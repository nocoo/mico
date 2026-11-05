import { useId } from 'react'
import type { CanvasShape } from '../shared/types'
import './sticky-note.css'

const OUTLINE =
	'M0 0 H160 V98.88 C160 120 160 140 160 160 C140 160 120 160 98.88 160 H0 Z'

export function StickyNote({ shape, animate }: { shape: CanvasShape; animate: boolean }) {
	const lightId = `sticky-light-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

	return (
		<g className={animate ? 'sticky-entry' : undefined}>
			<svg
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				viewBox="0 0 160 160"
				preserveAspectRatio="none"
				overflow="visible"
			>
				<defs>
					<radialGradient
						id={lightId}
						cx="150"
						cy="155"
						r="52"
						gradientUnits="userSpaceOnUse"
						gradientTransform="translate(0 77.5) scale(1 .5)"
					>
						<stop stopColor="var(--surface)" stopOpacity=".8" />
						<stop offset="1" stopColor="var(--surface)" stopOpacity="0" />
					</radialGradient>
				</defs>
				<ellipse
					className="sticky-corner-shadow"
					cx="139"
					cy="157"
					rx="22"
					ry="2.5"
					pointerEvents="none"
				/>
				<path className="sticky-paper sticky-outline" d={OUTLINE} fill={shape.color} />
				<path
					className="sticky-corner-light sticky-outline"
					d={OUTLINE}
					fill={`url(#${lightId})`}
					pointerEvents="none"
				/>
			</svg>
			<foreignObject
				x={shape.x + 12}
				y={shape.y + 12}
				width={Math.max(0, shape.w - 24)}
				height={Math.max(0, shape.h - 24)}
				pointerEvents="none"
			>
				<div className="sticky-text">{shape.text || ''}</div>
			</foreignObject>
		</g>
	)
}
