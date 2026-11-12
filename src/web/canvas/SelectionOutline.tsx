import type { CanvasShape } from '../../shared/types.ts'
import { selectionOutlineGeometry } from './selection-outline.ts'

export function SelectionOutline({ shape, zoom }: { shape: CanvasShape; zoom: number }) {
	const geometry = selectionOutlineGeometry(shape, zoom)
	return (
		<foreignObject
			className="selection"
			x={geometry.x}
			y={geometry.y}
			width={geometry.width}
			height={geometry.height}
			overflow="visible"
			pointerEvents="none"
		>
			<div
				style={{
					width: '100%',
					height: '100%',
					borderRadius: geometry.radius,
					outline: `${geometry.outlineWidth}px solid var(--ui-accent)`,
					outlineOffset: geometry.outlineOffset,
				}}
			/>
		</foreignObject>
	)
}
