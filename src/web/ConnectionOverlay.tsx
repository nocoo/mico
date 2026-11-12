import type React from 'react'
import type { CanvasShape, Connector, Shape } from '../shared/types'
import { getAnchors, getConnectorAnchors } from './anchors'
import {
	connectorPath,
	createConnectorGeometry,
	createConnectorVisualGeometry,
} from './canvas/connectorGeometry'
import { jellyStyle } from './canvas/jelly'
import { CANDY_LAYOUT } from './design'
import type { ConnectionDraft } from './useConnectionGesture'

interface ConnectionOverlayProps {
	draft: ConnectionDraft | null
	preview: ReturnType<typeof getConnectorAnchors> | null
	target?: CanvasShape
	selected: Connector | null
	shapes: Shape[]
	zoom: number
	controlSize: number
	onReconnect: (
		event: React.PointerEvent<SVGGElement>,
		connector: Connector,
		endpoint: 'from' | 'to',
	) => void
}

export function ConnectionOverlay({
	draft,
	preview,
	target,
	selected,
	shapes,
	zoom,
	controlSize,
	onReconnect,
}: ConnectionOverlayProps) {
	const from = selected ? shapes.find((shape) => shape.id === selected.from) : null
	const to = selected ? shapes.find((shape) => shape.id === selected.to) : null
	const handles =
		selected && from && to && from.type !== 'connector' && to.type !== 'connector'
			? getConnectorAnchors(from, to, selected)
			: null
	const inset = 8 / zoom
	const targetAnchors = target
		? getAnchors(target).map((point, anchorIndex) => ({ point, anchorIndex }))
		: []
	const uniqueAnchors = targetAnchors.filter(
		({ point }, index) =>
			targetAnchors.findIndex(({ point: other }) => point.x === other.x && point.y === other.y) ===
			index,
	)
	const fixed = draft
		? shapes.find((shape) => shape.id === draft.fixed.shapeId && shape.type !== 'connector')
		: undefined
	const previewFrom = draft?.endpoint === 'from' ? target : fixed
	const previewTo = draft?.endpoint === 'from' ? fixed : target
	const previewPins = draft
		? {
				fromAnchor: draft.endpoint === 'from' ? draft.target?.anchorIndex : draft.fixed.anchorIndex,
				toAnchor: draft.endpoint === 'from' ? draft.fixed.anchorIndex : draft.target?.anchorIndex,
			}
		: undefined
	const previewFromShape = previewFrom?.type !== 'connector' ? previewFrom : undefined
	const previewToShape = previewTo?.type !== 'connector' ? previewTo : undefined
	const previewGeometry =
		preview && draft
			? createConnectorVisualGeometry(
					createConnectorGeometry(
						preview.start,
						preview.end,
						previewFromShape,
						previewToShape,
						previewPins,
					),
					previewFromShape,
					previewToShape,
					previewPins,
				)
			: null
	return (
		<>
			{previewGeometry && draft && (
				<path
					className="connection-preview e-line"
					d={connectorPath(previewGeometry)}
					fill="none"
					stroke="currentColor"
					strokeWidth={3}
					strokeLinecap="round"
					style={{
						...jellyStyle(draft.original?.color ?? CANDY_LAYOUT.connector),
						color: 'var(--j-edge)',
					}}
					strokeDasharray={draft.target ? undefined : '8 8'}
					vectorEffect="non-scaling-stroke"
					markerEnd={previewGeometry.showArrow ? 'url(#arrow)' : undefined}
					pointerEvents="none"
				/>
			)}
			{target && draft && !draft.pending && (
				<g className="snap-target" data-snap-target={target.id} pointerEvents="none">
					{target.type === 'ellipse' ? (
						<ellipse
							cx={target.x + target.w / 2}
							cy={target.y + target.h / 2}
							rx={target.w / 2 + inset}
							ry={target.h / 2 + inset}
							className="snap-outline"
							vectorEffect="non-scaling-stroke"
						/>
					) : target.type === 'line' ? (
						<line
							x1={target.x}
							y1={target.y}
							x2={target.x + target.w}
							y2={target.y + target.h}
							className="snap-outline"
							vectorEffect="non-scaling-stroke"
						/>
					) : (
						<rect
							x={target.x - inset}
							y={target.y - inset}
							width={target.w + inset * 2}
							height={target.h + inset * 2}
							rx={8 / zoom}
							className="snap-outline"
							vectorEffect="non-scaling-stroke"
						/>
					)}
					{uniqueAnchors.map(({ point, anchorIndex }) => (
						<circle
							key={`${point.x}:${point.y}`}
							cx={point.x}
							cy={point.y}
							r={(draft.target?.anchorIndex === anchorIndex ? 6 : 3) / zoom}
							className={`snap-anchor ${draft.target?.anchorIndex === anchorIndex ? 'is-active' : ''}`}
							data-anchor-index={anchorIndex}
							vectorEffect="non-scaling-stroke"
						/>
					))}
				</g>
			)}
			{handles &&
				selected &&
				!draft &&
				(['from', 'to'] as const).map((endpoint) => {
					const point = endpoint === 'from' ? handles.start : handles.end
					return (
						// biome-ignore lint/a11y/useSemanticElements: SVG handles cannot contain an HTML button.
						<g
							key={endpoint}
							className="connection-handle"
							data-connection-handle={endpoint}
							role="button"
							tabIndex={0}
							aria-label={`Reconnect ${endpoint === 'from' ? 'source' : 'target'}`}
							onPointerDown={(event) => onReconnect(event, selected, endpoint)}
							onKeyDown={(event) => {
								if (event.key !== 'Enter' && event.key !== ' ') return
								event.preventDefault()
								event.stopPropagation()
								document.getElementById(`connection-${endpoint}`)?.focus()
							}}
						>
							<circle cx={point.x} cy={point.y} r={controlSize / (2 * zoom)} fill="transparent" />
							<circle
								className="handle-dot"
								cx={point.x}
								cy={point.y}
								r={6 / zoom}
								vectorEffect="non-scaling-stroke"
							/>
						</g>
					)
				})}
		</>
	)
}
