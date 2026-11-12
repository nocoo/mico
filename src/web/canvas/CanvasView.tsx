import type {
	CSSProperties,
	MouseEventHandler,
	PointerEventHandler,
	ReactNode,
	Ref,
	WheelEventHandler,
} from 'react'
import { computeGrid } from '../grid.ts'
import './canvas.css'

interface CanvasViewProps {
	svgRef: Ref<SVGSVGElement>
	viewport: { x: number; y: number; zoom: number }
	cursor: 'default' | 'grab' | 'grabbing'
	children: ReactNode
	onPointerDown: PointerEventHandler<SVGSVGElement>
	onPointerMove: PointerEventHandler<SVGSVGElement>
	onPointerUp: PointerEventHandler<SVGSVGElement>
	onPointerCancel: PointerEventHandler<SVGSVGElement>
	onWheel: WheelEventHandler<SVGSVGElement>
	onDoubleClick: MouseEventHandler<SVGSVGElement>
	onLostPointerCapture: PointerEventHandler<SVGSVGElement>
}

export function CanvasView({
	svgRef,
	viewport,
	cursor,
	children,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
	onWheel,
	onDoubleClick,
	onLostPointerCapture,
}: CanvasViewProps) {
	const grid = computeGrid(viewport)
	const style = {
		cursor,
		'--canvas-grid-size': `${grid.spacing}px`,
		'--canvas-grid-x': `${grid.offsetX}px`,
		'--canvas-grid-y': `${grid.offsetY}px`,
	} as CSSProperties

	return (
		<svg
			ref={svgRef}
			className="canvas"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			onWheel={onWheel}
			onDoubleClick={onDoubleClick}
			aria-label="Infinite canvas"
			style={style}
			onLostPointerCapture={onLostPointerCapture}
		>
			<g
				data-world-layer="true"
				transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
			>
				{children}
			</g>
		</svg>
	)
}
