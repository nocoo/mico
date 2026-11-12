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
	const radius = Math.max(0, Math.min(18, Math.abs(shape.w) / 2, Math.abs(shape.h) / 2))

	return (
		<>
			<defs>
				<clipPath id={clipId}>
					<rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={radius} />
				</clipPath>
			</defs>
			{backgroundImageId && (
				<image
					className="canvas-frame-background"
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
				rx={radius}
				style={jellyStyle(shape.color)}
				vectorEffect="non-scaling-stroke"
				pointerEvents="none"
			/>
		</>
	)
}
