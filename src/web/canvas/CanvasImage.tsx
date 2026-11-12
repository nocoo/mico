import type { CanvasShape } from '../../shared/types'
import './canvas-image.css'

export function CanvasImage({ shape }: { shape: CanvasShape }) {
	if (!shape.imageId) return null

	const radiusX = Math.max(0, Math.min(10, Math.abs(shape.w) / 2))
	const radiusY = Math.max(0, Math.min(10, Math.abs(shape.h) / 2))

	return (
		<>
			<rect
				className="canvas-image-hit"
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				rx={radiusX}
				ry={radiusY}
				fill="transparent"
				pointerEvents="all"
			/>
			<image
				className="canvas-image"
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				href={`/api/images/${encodeURIComponent(shape.imageId)}`}
				preserveAspectRatio="xMidYMid meet"
				style={{ clipPath: `inset(0 round ${radiusX}px / ${radiusY}px)` }}
				pointerEvents="none"
			/>
			<rect
				className="canvas-image-edge"
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				rx={radiusX}
				ry={radiusY}
				style={{ stroke: shape.color }}
				vectorEffect="non-scaling-stroke"
				pointerEvents="none"
			/>
		</>
	)
}
