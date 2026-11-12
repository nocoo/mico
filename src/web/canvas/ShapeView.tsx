import { Frame } from 'lucide-react'
import type React from 'react'
import type { CanvasShape, Connector, Point, Shape } from '../../shared/types'
import { BrushStroke } from '../BrushStroke'
import { CardHeaderPill } from '../CardHeaderPill'
import type { Tool } from '../design'
import { StickyNote } from '../StickyNote'
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
	visibleShapes: readonly Shape[]
	selectedIds: readonly string[]
	zoom: number
	connection: {
		draft: { original: Connector | null } | null
		preview: { start: Point; end: Point } | null
	}
	tool: Tool
	spacePressed: boolean
	isPanning: boolean
	animatedObjectIds: ReadonlySet<string>
	onEntryAnimationConsumed: (id: string) => void
	editingId: string | null
}

export function ShapeView({
	shape,
	visibleShapes,
	selectedIds,
	zoom,
	connection,
	tool,
	spacePressed,
	isPanning,
	animatedObjectIds,
	onEntryAnimationConsumed,
	editingId,
	onPointerDown,
	onDoubleClick,
}: ShapeViewProps) {
	const animated = animatedObjectIds.has(shape.id)

	if (shape.type === 'connector') {
		if (connection.draft?.original?.id === shape.id && connection.preview) return null
		const from = visibleShapes.find((item) => item.id === shape.from)
		const to = visibleShapes.find((item) => item.id === shape.to)
		if (!from || !to || from.type === 'connector' || to.type === 'connector') return null
		return (
			<ConnectorView
				shape={shape}
				from={from}
				to={to}
				selected={selectedIds.includes(shape.id)}
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

	const active = selectedIds.includes(shape.id)
	const pop =
		(shape.type === 'rectangle' || shape.type === 'ellipse' || shape.type === 'text') && animated
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

	if (shape.type === 'rectangle' || shape.type === 'ellipse') {
		return (
			<g {...common}>
				<JellyShape shape={shape} editing={editingId === shape.id} />
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
		const backgroundShape = shape.backgroundImageId
			? visibleShapes.find(
					(candidate) => candidate.type === 'image' && candidate.id === shape.backgroundImageId,
				)
			: undefined
		const backgroundImageId =
			backgroundShape?.type === 'image' ? backgroundShape.imageId : undefined
		return (
			<g className="canvas-shape frame" data-shape-id={shape.id}>
				<CanvasFrame shape={shape} backgroundImageId={backgroundImageId} />
				{active && <SelectionOutline shape={shape} zoom={zoom} />}
			</g>
		)
	}
	if (shape.type === 'note') {
		return (
			<g {...common}>
				<StickyNote
					shape={shape}
					animate={animatedObjectIds.has(shape.id)}
					editing={editingId === shape.id}
				/>
				{active && <SelectionOutline shape={shape} zoom={zoom} />}
			</g>
		)
	}
	if (shape.type === 'text') {
		return (
			<g {...common}>
				<CanvasText shape={shape} editing={editingId === shape.id} />
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
				<BrushStroke
					points={shape.points.map((point) => ({ x: shape.x + point.x, y: shape.y + point.y }))}
					brush={shape.brush}
					strokeWidth={
						active && shape.brush === 'pencil' && shape.strokeWidth === 4 ? 5 : shape.strokeWidth
					}
					color={shape.color}
				/>
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
}

export interface FrameLabelProps extends ShapeCallbacks {
	shape: CanvasShape
}

export function FrameLabel({ shape, onPointerDown, onDoubleClick }: FrameLabelProps) {
	return (
		<CardHeaderPill
			x={shape.x}
			y={shape.y}
			width={Math.min(shape.w, 360)}
			color={shape.color}
			title={shape.title ?? 'Frame'}
			icon={Frame}
			handleId={shape.id}
			onPointerDown={(event) => onPointerDown(event, shape)}
			onDoubleClick={(event) => onDoubleClick(event, shape)}
		/>
	)
}
