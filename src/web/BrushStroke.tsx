import type { BrushStyle, Point } from '../shared/types'
import { buildStroke } from './brush'
import { jellyStyle } from './canvas/jelly'

interface BrushStrokeProps {
	points: Point[]
	brush: BrushStyle
	strokeWidth: number
	color: string
	preview?: boolean
}

export function BrushStroke({ points, brush, strokeWidth, color, preview }: BrushStrokeProps) {
	if (points.length < 2) return null
	const stroke = buildStroke(points, strokeWidth, brush)
	if (stroke.mode === 'fill') {
		return (
			<path
				d={stroke.d}
				fill="var(--j-edge)"
				style={jellyStyle(color)}
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
			style={jellyStyle(color)}
			strokeWidth={marker ? strokeWidth * 1.8 : strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			opacity={marker ? 0.35 : preview ? 0.7 : 1}
		/>
	)
}
