import type { CanvasShape } from '../../shared/types.ts'
import { selectionOutlineGeometry } from './selection-outline.ts'

export function SelectionOutline({ shape, zoom }: { shape: CanvasShape; zoom: number }) {
	const geometry = selectionOutlineGeometry(shape, zoom)

	if (geometry.kind === 'ellipse') {
		return (
			<ellipse
				className="selection"
				cx={geometry.cx}
				cy={geometry.cy}
				rx={geometry.rx}
				ry={geometry.ry}
				fill="none"
				stroke="var(--ui-accent)"
				strokeWidth={2.5}
				strokeDasharray="none"
				vectorEffect="non-scaling-stroke"
				pointerEvents="none"
				style={{
					fill: 'none',
					stroke: 'var(--ui-accent)',
					strokeWidth: 2.5,
					strokeDasharray: 'none',
				}}
			/>
		)
	}

	return (
		<rect
			className="selection"
			x={geometry.x}
			y={geometry.y}
			width={geometry.width}
			height={geometry.height}
			rx={geometry.rx}
			fill="none"
			stroke="var(--ui-accent)"
			strokeWidth={2.5}
			strokeDasharray="none"
			vectorEffect="non-scaling-stroke"
			pointerEvents="none"
			style={{
				fill: 'none',
				stroke: 'var(--ui-accent)',
				strokeWidth: 2.5,
				strokeDasharray: 'none',
			}}
		/>
	)
}
