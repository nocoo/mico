import { GripVertical, type LucideIcon } from 'lucide-react'
import type React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

interface CardHeaderPillProps {
	x: number
	y: number
	width: number
	color: string
	title: string
	icon: LucideIcon
	handleId?: string
	onPointerDown?: (event: React.PointerEvent<SVGGElement>) => void
	onDoubleClick?: (event: React.MouseEvent<SVGGElement>) => void
}

export function CardHeaderPill({
	x,
	y,
	width,
	color,
	title,
	icon: Icon,
	handleId,
	onPointerDown,
	onDoubleClick,
}: CardHeaderPillProps) {
	const pillRef = useRef<HTMLDivElement>(null)
	const [hitWidth, setHitWidth] = useState(0)
	const maxWidth = Math.max(160, Math.min(width, 360))
	const interactive = Boolean(onPointerDown || onDoubleClick)
	const handlers = interactive ? { onPointerDown, onDoubleClick } : {}

	useLayoutEffect(() => {
		const pill = pillRef.current
		if (!pill) return
		const measure = () => setHitWidth(Math.min(maxWidth, pill.offsetWidth))
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(pill)
		return () => observer.disconnect()
	}, [maxWidth])

	return (
		<g
			className="card-header-handle"
			data-card-handle={handleId}
			{...handlers}
			style={{ cursor: interactive ? 'move' : 'default' }}
		>
			<foreignObject x={x} y={y - 40} width={maxWidth} height={36} pointerEvents="none">
				<div className="card-pill" ref={pillRef}>
					<span className="card-pill-icon" style={{ color, background: `${color}1f` }}>
						<Icon size={14} strokeWidth={1.5} aria-hidden="true" />
					</span>
					<span className="card-pill-title">{title}</span>
					<GripVertical className="card-pill-grip" size={14} strokeWidth={1.5} aria-hidden="true" />
				</div>
			</foreignObject>
			{interactive && hitWidth > 0 && (
				<rect x={x} y={y - 40} width={hitWidth} height={36} fill="transparent" />
			)}
		</g>
	)
}
