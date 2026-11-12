import type { Rect } from '../selection'

export function Marquee({ rect, zoom }: { rect: Rect; zoom: number }) {
	return (
		<foreignObject
			className="marquee"
			x={rect.x}
			y={rect.y}
			width={rect.w}
			height={rect.h}
			pointerEvents="none"
		>
			<div
				style={{
					width: '100%',
					height: '100%',
					borderRadius: `${10 / zoom}px`,
					background: 'var(--ui-accent-soft)',
					boxShadow: `inset 0 0 0 ${1.5 / zoom}px color-mix(in oklch, var(--ui-accent) 70%, transparent)`,
				}}
			/>
		</foreignObject>
	)
}
