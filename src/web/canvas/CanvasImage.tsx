import type { CanvasShape } from '../../shared/types'
import { jellyStyle } from './jelly'
import './canvas-image.css'

export function CanvasImage({ shape }: { shape: CanvasShape }) {
	if (!shape.imageId) return null

	const clipId = `canvas-image-${shape.id}`
	const radius = Math.max(0, Math.min(10, Math.abs(shape.w) / 2, Math.abs(shape.h) / 2))

	return (
		<>
			<defs>
				<clipPath id={clipId}>
					<rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={radius} />
				</clipPath>
			</defs>
			<rect
				className="canvas-image-hit"
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				rx={radius}
				fill="transparent"
				pointerEvents="all"
			/>
			<image
				className="canvas-image-art"
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				href={`/api/images/${encodeURIComponent(shape.imageId)}`}
				preserveAspectRatio="xMidYMid meet"
				clipPath={`url(#${clipId})`}
				pointerEvents="none"
			/>
			<rect
				className="canvas-image-edge"
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
