import type { CanvasShape } from '../../shared/types'
import { imagePreserveAspectRatio } from '../image'
import { jellyStyle } from './jelly'
import './canvas-frame.css'

export function CanvasFrame({
	shape,
	backgroundImageId,
}: {
	shape: CanvasShape
	backgroundImageId?: string
}) {
	const clipId = `canvas-frame-${shape.id}`
	const radiusX = Math.max(0, Math.min(18, Math.abs(shape.w) / 2))
	const radiusY = Math.max(0, Math.min(18, Math.abs(shape.h) / 2))

	return (
		<>
			<defs>
				<clipPath id={clipId}>
					<rect
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						rx={radiusX}
						ry={radiusY}
					/>
				</clipPath>
			</defs>
			{backgroundImageId && (
				<image
					className="frame-background-image"
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
					href={`/api/images/${encodeURIComponent(backgroundImageId)}`}
					preserveAspectRatio={imagePreserveAspectRatio(shape.backgroundFit)}
					clipPath={`url(#${clipId})`}
					pointerEvents="none"
				/>
			)}
			<rect
				className={`canvas-frame-surface${backgroundImageId ? ' has-background' : ''}`}
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				rx={radiusX}
				ry={radiusY}
				style={jellyStyle(shape.color)}
				vectorEffect="non-scaling-stroke"
				pointerEvents="none"
			/>
		</>
	)
}
