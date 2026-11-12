import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OverviewCanvasSize, OverviewProjection } from '../../shared/overview.ts'
import {
	canvasViewportRect,
	OVERVIEW_HEIGHT,
	OVERVIEW_WIDTH,
	overviewPointToWorld,
	overviewProjection,
	projectOverviewRect,
	viewportCenteredOn,
} from '../../shared/overview.ts'
import type { Shape } from '../../shared/types.ts'
import { panelViewportInset } from '../viewport.ts'
import { jellyStyle } from './jelly.ts'
import './canvas-minimap.css'

export interface CanvasMinimapProps {
	shapes: Shape[]
	viewport: { x: number; y: number; zoom: number }
	canvasRef: RefObject<SVGSVGElement | null>
	onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void
	canvasId: string
}

function reservedCanvasWidth(canvas: SVGSVGElement | null, width: number) {
	if (!canvas) return 0
	const style = getComputedStyle(canvas)
	const reserved = Number.parseFloat(style.getPropertyValue('--frame-panel-reserved')) || 0
	if (!reserved) return 0
	const panel = document.getElementById('ai-panel')
	if (!panel) return 0
	const panelStyle = getComputedStyle(panel)
	return panelViewportInset(
		width,
		reserved,
		Number.parseFloat(panelStyle.width) || 0,
		Number.parseFloat(panelStyle.getPropertyValue('--ai-inset')) || 0,
	)
}

function pointInOverview(event: PointerEvent<SVGSVGElement>) {
	const rect = event.currentTarget.getBoundingClientRect()
	return {
		x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * OVERVIEW_WIDTH,
		y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * OVERVIEW_HEIGHT,
	}
}

export function CanvasMinimap({
	shapes,
	viewport,
	canvasRef,
	onViewportChange,
	canvasId,
}: CanvasMinimapProps) {
	const [canvasBounds, setCanvasBounds] = useState({ width: 1, height: 1 })
	const [dragging, setDragging] = useState(false)
	const frozenProjection = useRef<OverviewProjection | null>(null)
	const pointerId = useRef<number | null>(null)
	const pointerTarget = useRef<SVGSVGElement | null>(null)
	const renderedCanvasId = useRef(canvasId)

	useLayoutEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const measure = () => {
			const rect = canvas.getBoundingClientRect()
			setCanvasBounds({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(canvas)
		return () => observer.disconnect()
	}, [canvasRef])

	useEffect(() => {
		if (renderedCanvasId.current === canvasId) return
		renderedCanvasId.current = canvasId
		const target = pointerTarget.current
		if (target && pointerId.current !== null && target.hasPointerCapture(pointerId.current)) {
			target.releasePointerCapture(pointerId.current)
		}
		pointerTarget.current = null
		pointerId.current = null
		frozenProjection.current = null
		setDragging(false)
	}, [canvasId])

	const canvas: OverviewCanvasSize = {
		...canvasBounds,
		rightInset: reservedCanvasWidth(canvasRef.current, canvasBounds.width),
	}
	const visibleViewport = canvasViewportRect(viewport, canvas)
	const projection = overviewProjection(shapes, {
		width: OVERVIEW_WIDTH,
		height: OVERVIEW_HEIGHT,
		padding: 12,
		viewport: visibleViewport,
	})
	const shownProjection =
		dragging && frozenProjection.current ? frozenProjection.current : projection
	const outline = projectOverviewRect(shownProjection, visibleViewport)

	const navigate = (event: PointerEvent<SVGSVGElement>, activeProjection: OverviewProjection) => {
		const point = pointInOverview(event)
		const world = overviewPointToWorld(activeProjection, point.x, point.y)
		onViewportChange(viewportCenteredOn(viewport, canvas, world))
	}

	const finishDrag = (target = pointerTarget.current) => {
		const activePointer = pointerId.current
		if (target && activePointer !== null && target.hasPointerCapture(activePointer)) {
			target.releasePointerCapture(activePointer)
		}
		pointerTarget.current = null
		pointerId.current = null
		frozenProjection.current = null
		setDragging(false)
	}

	const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
		if (event.button !== 0) return
		event.preventDefault()
		event.currentTarget.parentElement?.focus()
		frozenProjection.current = projection
		pointerId.current = event.pointerId
		pointerTarget.current = event.currentTarget
		setDragging(true)
		event.currentTarget.setPointerCapture(event.pointerId)
		navigate(event, projection)
	}

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		const offsets = {
			ArrowLeft: [-0.1, 0],
			ArrowRight: [0.1, 0],
			ArrowUp: [0, -0.1],
			ArrowDown: [0, 0.1],
		} as const
		const offset = offsets[event.key as keyof typeof offsets]
		if (!offset) return
		event.preventDefault()
		const width = visibleViewport.right - visibleViewport.left
		const height = visibleViewport.bottom - visibleViewport.top
		const center = {
			x: (visibleViewport.left + visibleViewport.right) / 2 + width * offset[0],
			y: (visibleViewport.top + visibleViewport.bottom) / 2 + height * offset[1],
		}
		onViewportChange(viewportCenteredOn(viewport, canvas, center))
	}

	return (
		<button
			type="button"
			className={`canvas-minimap${dragging ? ' dragging' : ''}`}
			data-canvas-id={canvasId}
			aria-label="Canvas overview. Use arrow keys to move the viewport."
			aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
			onKeyDown={onKeyDown}
		>
			<svg
				className="canvas-minimap-map"
				viewBox={`0 0 ${OVERVIEW_WIDTH} ${OVERVIEW_HEIGHT}`}
				aria-hidden="true"
				data-canvas-id={canvasId}
				onPointerDown={onPointerDown}
				onPointerMove={(event) => {
					if (event.pointerId === pointerId.current && frozenProjection.current) {
						navigate(event, frozenProjection.current)
					}
				}}
				onPointerUp={(event) => {
					if (event.pointerId === pointerId.current) finishDrag(event.currentTarget)
				}}
				onPointerCancel={(event) => {
					if (event.pointerId === pointerId.current) finishDrag(event.currentTarget)
				}}
				onLostPointerCapture={(event) => {
					if (event.pointerId === pointerId.current) finishDrag(event.currentTarget)
				}}
			>
				{shownProjection.blocks.map((block) => {
					const style = jellyStyle(block.color)
					const common = {
						className: `canvas-minimap-block ${block.type}`,
						style,
					}
					return block.type === 'ellipse' ? (
						<ellipse
							key={block.id}
							{...common}
							cx={block.projectedX + block.projectedWidth / 2}
							cy={block.projectedY + block.projectedHeight / 2}
							rx={block.projectedWidth / 2}
							ry={block.projectedHeight / 2}
						/>
					) : (
						<rect
							key={block.id}
							{...common}
							x={block.projectedX}
							y={block.projectedY}
							width={block.projectedWidth}
							height={block.projectedHeight}
							rx={block.type === 'frame' ? 4 : 2}
						/>
					)
				})}
				<rect
					className="canvas-minimap-viewport"
					x={outline.left}
					y={outline.top}
					width={Math.max(1, outline.right - outline.left)}
					height={Math.max(1, outline.bottom - outline.top)}
					rx={4}
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
		</button>
	)
}
