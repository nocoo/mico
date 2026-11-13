import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
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
import { viewportAfterOverviewDrag } from './minimap.ts'
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
	const [canvas, setCanvas] = useState<OverviewCanvasSize>({ width: 1, height: 1, rightInset: 0 })
	const [dragging, setDragging] = useState(false)
	const frozenProjection = useRef<OverviewProjection | null>(null)
	const dragStart = useRef<{
		point: { x: number; y: number }
		viewport: CanvasMinimapProps['viewport']
		clientX: number
		clientY: number
		moved: boolean
	} | null>(null)
	const pointerId = useRef<number | null>(null)
	const pointerTarget = useRef<SVGSVGElement | null>(null)
	const renderedCanvasId = useRef(canvasId)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const measure = () => {
			const rect = canvas.getBoundingClientRect()
			const next = {
				width: Math.max(1, rect.width),
				height: Math.max(1, rect.height),
				rightInset: reservedCanvasWidth(canvas, rect.width),
			}
			setCanvas((current) =>
				current.width === next.width &&
				current.height === next.height &&
				current.rightInset === next.rightInset
					? current
					: next,
			)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(canvas)
		const app = canvas.closest('.app')
		const frameObserver = new MutationObserver(measure)
		if (app) frameObserver.observe(app, { attributes: true, attributeFilter: ['class', 'style'] })
		return () => {
			observer.disconnect()
			frameObserver.disconnect()
		}
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
		dragStart.current = null
		setDragging(false)
	}, [canvasId])

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
		pointerTarget.current = null
		pointerId.current = null
		frozenProjection.current = null
		dragStart.current = null
		setDragging(false)
		if (target && activePointer !== null && target.hasPointerCapture(activePointer)) {
			target.releasePointerCapture(activePointer)
		}
	}

	const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
		if (event.button !== 0 || pointerId.current !== null) return
		event.preventDefault()
		event.currentTarget.parentElement?.focus()
		frozenProjection.current = projection
		dragStart.current = {
			point: pointInOverview(event),
			viewport: { ...viewport },
			clientX: event.clientX,
			clientY: event.clientY,
			moved: false,
		}
		pointerId.current = event.pointerId
		pointerTarget.current = event.currentTarget
		setDragging(true)
		event.currentTarget.setPointerCapture(event.pointerId)
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
					const activeProjection = frozenProjection.current
					const start = dragStart.current
					if (event.pointerId !== pointerId.current || !activeProjection || !start) return
					if (viewport.zoom !== start.viewport.zoom) {
						start.viewport = { ...viewport }
						start.point = pointInOverview(event)
						start.clientX = event.clientX
						start.clientY = event.clientY
						start.moved = true
						return
					}
					if (
						!start.moved &&
						Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 3
					) {
						return
					}
					start.moved = true
					onViewportChange(
						viewportAfterOverviewDrag(
							activeProjection,
							start.viewport,
							canvas,
							start.point,
							pointInOverview(event),
						),
					)
				}}
				onPointerUp={(event) => {
					if (event.pointerId !== pointerId.current) return
					const activeProjection = frozenProjection.current
					if (activeProjection && !dragStart.current?.moved) navigate(event, activeProjection)
					finishDrag(event.currentTarget)
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
