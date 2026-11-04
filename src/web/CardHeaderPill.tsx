import { GripVertical, type LucideIcon } from 'lucide-react'

interface CardHeaderPillProps {
	x: number
	y: number
	width: number
	color: string
	title: string
	icon: LucideIcon
}

export function CardHeaderPill({ x, y, width, color, title, icon: Icon }: CardHeaderPillProps) {
	return (
		<foreignObject
			x={x}
			y={y - 40}
			width={Math.max(160, Math.min(width, 360))}
			height={36}
			pointerEvents="none"
		>
			<div className="card-pill">
				<span className="card-pill-icon" style={{ color, background: `${color}1f` }}>
					<Icon size={14} strokeWidth={1.5} aria-hidden="true" />
				</span>
				<span className="card-pill-title">{title}</span>
				<GripVertical className="card-pill-grip" size={14} strokeWidth={1.5} aria-hidden="true" />
			</div>
		</foreignObject>
	)
}
