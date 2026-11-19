import { memo, useMemo } from 'react'
import type { BrushStyle, Point } from '../shared/types'
import { buildStroke } from './brush'
import { adaptiveJellyStyle } from './design'

interface BrushStrokeProps {
	points: Point[]
	brush: BrushStyle
	strokeWidth: number
	color: string
	preview?: boolean
}

export const BrushStroke = memo(function BrushStroke({
	points,
	brush,
	strokeWidth,
	color,
	preview,
}: BrushStrokeProps) {
	const stroke = useMemo(
		() => (points.length < 2 ? null : buildStroke(points, strokeWidth, brush)),
		[points, strokeWidth, brush],
	)
	if (!stroke) return null
	if (stroke.mode === 'fill') {
		return (
			<path
				d={stroke.d}
				fill="var(--j-edge)"
				style={adaptiveJellyStyle(color)}
				opacity={preview ? 0.65 : 0.95}
			/>
		)
	}
	const marker = brush === 'marker'
	return (
		<path
			d={stroke.d}
			fill="none"
			stroke="var(--j-edge)"
			style={adaptiveJellyStyle(color)}
			strokeWidth={marker ? strokeWidth * 1.8 : strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			opacity={marker ? 0.35 : preview ? 0.7 : 1}
		/>
	)
})
