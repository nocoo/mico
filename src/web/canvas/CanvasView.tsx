import type {
	MouseEventHandler,
	PointerEventHandler,
	ReactNode,
	Ref,
	WheelEventHandler,
} from 'react'

interface CanvasViewProps {
	svgRef: Ref<SVGSVGElement>
	viewport: { x: number; y: number; zoom: number }
	cursor: 'default' | 'grab' | 'grabbing'
	grid: ReactNode
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
	grid,
	children,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
	onWheel,
	onDoubleClick,
	onLostPointerCapture,
}: CanvasViewProps) {
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
			style={{ cursor }}
			onLostPointerCapture={onLostPointerCapture}
		>
			<defs>
				<marker
					id="arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
				</marker>
			</defs>
			{grid}
			<g
				data-world-layer="true"
				transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
			>
				{children}
			</g>
		</svg>
	)
}
