import type React from 'react'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { CanvasShape, Shape } from '../../shared/types'
import { BrushStroke } from '../BrushStroke'
import type { Tool } from '../design'
import { StickyNote } from '../StickyNote'
import { CanvasActions } from './CanvasActions'
import { CanvasFrame } from './CanvasFrame'
import { CanvasImage } from './CanvasImage'
import { CanvasText } from './CanvasText'
import { ConnectorView } from './ConnectorView'
import { HtmlCardLabel } from './HtmlCardLabel'
import { HtmlCardSurface } from './HtmlCardSurface'
import { JellyShape } from './JellyShape'
import { SelectionOutline } from './SelectionOutline'
import './canvas-entry.css'

interface ShapeCallbacks {
	onPointerDown: (event: React.PointerEvent<SVGGElement>, shape: Shape) => void
	onDoubleClick: (event: React.MouseEvent<SVGGElement>, shape: CanvasShape) => void
}

export interface ShapeViewProps extends ShapeCallbacks {
	shape: Shape
	selected: boolean
	fromShape?: CanvasShape
	toShape?: CanvasShape
	backgroundImageAssetId?: string
	hiddenForConnectionDraft?: boolean
	zoom: number
	tool: Tool
	spacePressed: boolean
	isPanning: boolean
	animatedObjectIds: ReadonlySet<string>
	onEntryAnimationConsumed: (id: string) => void
	editing: boolean
	onActionToggle: (shapeId: string, itemId: string, done: boolean) => void
	actionsDisabled: boolean
}

export const ShapeView = memo(function ShapeView({
	shape,
	selected,
	fromShape,
	toShape,
	backgroundImageAssetId,
	hiddenForConnectionDraft,
	zoom,
	tool,
	spacePressed,
	isPanning,
	animatedObjectIds,
	onEntryAnimationConsumed,
	editing,
	onActionToggle,
	actionsDisabled,
	onPointerDown,
	onDoubleClick,
}: ShapeViewProps) {
	const animated = animatedObjectIds.has(shape.id)

	if (shape.type === 'connector') {
		if (hiddenForConnectionDraft || !fromShape || !toShape) return null
		return (
			<ConnectorView
				shape={shape}
				from={fromShape}
				to={toShape}
				selected={selected}
				animate={animated}
				onAnimationComplete={() => onEntryAnimationConsumed(shape.id)}
				cursor={
					tool === 'hand' || spacePressed || isPanning
						? isPanning
							? 'grabbing'
							: 'grab'
						: 'pointer'
				}
				onPointerDown={(event) => onPointerDown(event, shape)}
			/>
		)
	}

	const active = selected
	const pop =
		(shape.type === 'rectangle' ||
			shape.type === 'ellipse' ||
			shape.type === 'text' ||
			shape.type === 'actions') &&
		animated
	const common = {
		className: `canvas-shape${pop ? ' canvas-entry' : ''}`,
		onAnimationEnd: (event: React.AnimationEvent<SVGGElement>) => {
			if (event.animationName !== 'canvas-entry-pop') return
			event.currentTarget.classList.remove('canvas-entry')
			onEntryAnimationConsumed(shape.id)
		},
		'data-shape-id': shape.id,
		onDoubleClick: (event: React.MouseEvent<SVGGElement>) => onDoubleClick(event, shape),
		style: {
			cursor:
				tool === 'hand' || spacePressed || isPanning ? (isPanning ? 'grabbing' : 'grab') : 'move',
		},
		onPointerDown: (event: React.PointerEvent<SVGGElement>) => onPointerDown(event, shape),
	}

	if (shape.type === 'actions') {
		return (
			<g {...common}>
				<rect
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
					fill="transparent"
					pointerEvents="all"
				/>
				<foreignObject
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
					overflow="visible"
					pointerEvents="auto"
				>
					<CanvasActions
						color={shape.color}
						items={shape.items ?? []}
						title={shape.title}
						onToggle={(itemId, done) => onActionToggle(shape.id, itemId, done)}
						disabled={actionsDisabled}
						interactive={tool === 'select' && !spacePressed && !isPanning}
					/>
				</foreignObject>
				{active && <SelectionOutline shape={shape} zoom={zoom} />}
			</g>
		)
	}
	if (shape.type === 'rectangle' || shape.type === 'ellipse') {
		return (
			<g {...common}>
				<JellyShape shape={shape} editing={editing} />
				{active && <SelectionOutline shape={shape} zoom={zoom} />}
			</g>
		)
	}
	if (shape.type === 'html') {
		return (
			<g {...common}>
				<HtmlCardSurface shape={shape} active={active} />
				<HtmlCardLabel
					shape={shape}
					onPointerDown={(event) => onPointerDown(event, shape)}
					onDoubleClick={(event) => onDoubleClick(event, shape)}
				/>
				{active && <SelectionOutline shape={shape} zoom={zoom} />}
			</g>
		)
	}
	if (shape.type === 'image') {
		if (!shape.imageId) return null
		return (
			<g {...common}>
				<CanvasImage shape={shape} />
				{active && <SelectionOutline shape={shape} zoom={zoom} />}
			</g>
		)
	}
	if (shape.type === 'frame') {
		return (
			<g className="canvas-shape frame" data-shape-id={shape.id}>
				<CanvasFrame shape={shape} backgroundImageId={backgroundImageAssetId} />
				{active && <SelectionOutline shape={shape} zoom={zoom} />}
			</g>
		)
	}
	if (shape.type === 'note') {
		return (
			<g {...common}>
				<StickyNote shape={shape} animate={animatedObjectIds.has(shape.id)} editing={editing} />
				{active && <SelectionOutline shape={shape} zoom={zoom} />}
			</g>
		)
	}
	if (shape.type === 'text') {
		return (
			<g {...common}>
				<CanvasText shape={shape} editing={editing} />
				{active && <SelectionOutline shape={shape} zoom={zoom} />}
			</g>
		)
	}
	if (shape.type === 'path' && shape.points && shape.brush && shape.strokeWidth) {
		return (
			<g
				{...common}
				style={{
					...common.style,
					filter: active ? 'drop-shadow(0 0 5px var(--ui-accent))' : undefined,
				}}
			>
				<g transform={`translate(${shape.x} ${shape.y})`}>
					<BrushStroke
						points={shape.points}
						brush={shape.brush}
						strokeWidth={
							active && shape.brush === 'pencil' && shape.strokeWidth === 4 ? 5 : shape.strokeWidth
						}
						color={shape.color}
					/>
				</g>
			</g>
		)
	}
	return (
		<g {...common}>
			<line
				x1={shape.x}
				y1={shape.y}
				x2={shape.x + shape.w}
				y2={shape.y + shape.h}
				stroke="transparent"
				strokeWidth={16}
			/>
			<line
				x1={shape.x}
				y1={shape.y}
				x2={shape.x + shape.w}
				y2={shape.y + shape.h}
				stroke={shape.color}
				strokeWidth={active ? 3 : 2}
			/>
			{active && <SelectionOutline shape={shape} zoom={zoom} />}
		</g>
	)
})

export interface FrameLabelProps extends ShapeCallbacks {
	shape: CanvasShape
}

export function FrameLabel({ shape, onPointerDown, onDoubleClick }: FrameLabelProps) {
	const width = Math.max(160, Math.min(shape.w, 360))
	const labelRef = useRef<HTMLDivElement>(null)
	const [hitWidth, setHitWidth] = useState(0)
	useLayoutEffect(() => {
		const label = labelRef.current
		if (!label) return
		const measure = () => setHitWidth(Math.min(width, label.offsetWidth))
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(label)
		return () => observer.disconnect()
	}, [width])
	const handlers = {
		onPointerDown: (event: React.PointerEvent<SVGGElement>) => onPointerDown(event, shape),
		onDoubleClick: (event: React.MouseEvent<SVGGElement>) => onDoubleClick(event, shape),
	}
	return (
		<g className="canvas-frame-label-handle" data-card-handle={shape.id} {...handlers}>
			<foreignObject x={shape.x} y={shape.y - 36} width={width} height={28} pointerEvents="none">
				<div className="canvas-frame-label" ref={labelRef}>
					<span className="canvas-frame-label-text">{shape.title ?? 'Frame'}</span>
				</div>
			</foreignObject>
			{hitWidth > 0 && (
				<rect x={shape.x} y={shape.y - 36} width={hitWidth} height={28} fill="transparent" />
			)}
		</g>
	)
}
