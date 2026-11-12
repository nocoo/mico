import type React from 'react'
import type { CanvasShape, Connector } from '../../shared/types'
import { connectorPath, getConnectorGeometry } from './connectorGeometry'

export interface ConnectorViewProps {
	shape: Connector
	from: CanvasShape
	to: CanvasShape
	selected: boolean
	cursor: string
	onPointerDown: React.PointerEventHandler<SVGGElement>
}

export function ConnectorView({
	shape,
	from,
	to,
	selected,
	cursor,
	onPointerDown,
}: ConnectorViewProps) {
	const path = connectorPath(getConnectorGeometry(shape, from, to))
	return (
		<g
			className="canvas-shape connector"
			data-shape-id={shape.id}
			style={{ cursor }}
			onPointerDown={onPointerDown}
		>
			<path
				className="connector-hit"
				d={path}
				fill="none"
				stroke="transparent"
				strokeWidth={16}
				pointerEvents="stroke"
				vectorEffect="non-scaling-stroke"
			/>
			<path
				className="connector-line"
				d={path}
				fill="none"
				stroke={shape.color}
				strokeWidth={selected ? 5 : 3}
				strokeLinecap="round"
				markerEnd="url(#arrow)"
				vectorEffect="non-scaling-stroke"
			/>
		</g>
	)
}
