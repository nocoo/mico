import bootstrapCss from 'bootstrap/dist/css/bootstrap.min.css?raw'
import bootstrapJs from 'bootstrap/dist/js/bootstrap.bundle.min.js?raw'
import { CodeXml, Frame } from 'lucide-react'
import type React from 'react'
import { useEffect } from 'react'
import { FRAME_FILL_PERCENT } from '../../shared/palette'
import type { CanvasShape, Connector, Point, Shape } from '../../shared/types'
import { BrushStroke } from '../BrushStroke'
import { CardHeaderPill } from '../CardHeaderPill'
import { CANDY_COLORS, candyLine, candyWash, type Tool } from '../design'
import { HTML_CARD_SANDBOX, htmlCardDocument } from '../htmlCard'
import { imagePreserveAspectRatio } from '../image'
import { StickyNote } from '../StickyNote'
import { CanvasText } from './CanvasText'
import { ConnectorView } from './ConnectorView'
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
	useEffect(() => {
		if (shape.type !== 'note' && animated) onEntryAnimationConsumed(shape.id)
	}, [animated, onEntryAnimationConsumed, shape.id, shape.type])

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
				<rect
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
					rx={10}
					style={{
						fill: candyWash(shape.color, 5),
						stroke: active ? shape.color : candyLine(shape.color),
					}}
					strokeWidth={active ? 2 : 1}
					vectorEffect="non-scaling-stroke"
				/>
				<foreignObject
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
					pointerEvents={active ? 'auto' : 'none'}
				>
					<div className="html-card">
						{shape.html ? (
							<iframe
								className="html-card-frame"
								title={shape.title ?? 'HTML card'}
								sandbox={HTML_CARD_SANDBOX}
								referrerPolicy="no-referrer"
								srcDoc={htmlCardDocument(shape.html, bootstrapCss, bootstrapJs)}
							/>
						) : (
							<div className="html-card-empty">HTML content is generated through the API</div>
						)}
					</div>
				</foreignObject>
				<CardHeaderPill
					x={shape.x}
					y={shape.y}
					width={Math.min(shape.w, 360)}
					color={shape.color}
					title={shape.title ?? 'HTML card'}
					icon={CodeXml}
					handleId={shape.id}
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
				<image
					className="canvas-image"
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
					href={`/api/images/${encodeURIComponent(shape.imageId)}`}
					preserveAspectRatio="xMidYMid meet"
					style={{
						clipPath: `inset(0 round ${Math.min(10, shape.w / 2)}px / ${Math.min(10, shape.h / 2)}px)`,
					}}
					pointerEvents="none"
				/>
				<rect
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
					rx={10}
					fill="transparent"
					stroke={shape.color ?? CANDY_COLORS.ink}
					strokeWidth={active ? 3 : 1}
					vectorEffect="non-scaling-stroke"
				/>
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
		const clipId = `frame-bg-${shape.id}`
		return (
			<g className="canvas-shape frame" data-shape-id={shape.id}>
				<defs>
					<clipPath id={clipId}>
						<rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={10} />
					</clipPath>
				</defs>
				{backgroundImageId && (
					<image
						className="frame-background-image"
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						href={`/api/images/${encodeURIComponent(backgroundImageId)}`}
						preserveAspectRatio={imagePreserveAspectRatio(shape.backgroundFit)}
						clipPath={`url(#${clipId})`}
						pointerEvents="none"
					/>
				)}
				<rect
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
					rx={10}
					style={{
						fill: backgroundImageId ? 'none' : candyWash(shape.color, FRAME_FILL_PERCENT),
						stroke: active ? shape.color : candyLine(shape.color),
					}}
					strokeWidth={active ? 2 : 1}
					vectorEffect="non-scaling-stroke"
					pointerEvents="none"
				/>
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
