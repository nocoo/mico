import type React from 'react'
import type { CanvasShape, Connector } from '../../shared/types'
import { ConnectorHead } from './ConnectorHead'
import { connectorPath, getConnectorVisualGeometry } from './connectorGeometry'
import { entryAnimationCompleted } from './entry-animation'
import { jellyStyle } from './jelly'
import './canvas-entry.css'

export interface ConnectorViewProps {
	shape: Connector
	from: CanvasShape
	to: CanvasShape
	selected: boolean
	animate: boolean
	onAnimationComplete: () => void
	cursor: string
	onPointerDown: React.PointerEventHandler<SVGGElement>
}

export function ConnectorView({
	shape,
	from,
	to,
	selected,
	animate,
	onAnimationComplete,
	cursor,
	onPointerDown,
}: ConnectorViewProps) {
	const geometry = getConnectorVisualGeometry(shape, from, to)
	const path = connectorPath(geometry)
	return (
		<g
			className={`canvas-shape connector edge${selected ? ' sel' : ''}${animate ? ' draw' : ''}`}
			data-shape-id={shape.id}
			style={{ ...jellyStyle(shape.color), color: 'var(--j-edge)', cursor }}
			onPointerDown={onPointerDown}
			onAnimationEnd={(event) => {
				if (entryAnimationCompleted('draw', event.animationName)) onAnimationComplete()
			}}
		>
			<path
				className="connector-hit e-hit"
				d={path}
				fill="none"
				stroke="transparent"
				strokeWidth={16}
				pointerEvents="stroke"
				vectorEffect="non-scaling-stroke"
			/>
			<path
				className="connector-line e-line"
				d={path}
				pathLength={1}
				fill="none"
				stroke="currentColor"
				strokeWidth={selected ? 5 : 3}
				strokeLinecap="round"
				filter={selected ? 'drop-shadow(0 0 4px currentColor)' : undefined}
			/>
			<ConnectorHead geometry={geometry} />
		</g>
	)
}
