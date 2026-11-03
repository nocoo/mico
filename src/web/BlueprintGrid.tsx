import { useId } from 'react'
import { computeGrid, type GridViewport, gridPathData } from './grid.ts'

const MAJOR_STROKE = 1
const MID_STROKE = 1
const FINE_STROKE = 0.5
const MID_DASH = '4 4'

export function BlueprintGrid({ viewport }: { viewport: GridViewport }) {
	const rawId = useId()
	const patternId = `blueprint-grid-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

	const metrics = computeGrid(viewport)
	const { tile, offsetX, offsetY, detail } = metrics
	const paths = gridPathData(metrics)

	return (
		<g className="blueprint-grid" focusable="false" pointerEvents="none">
			<defs>
				<pattern
					id={patternId}
					width={tile}
					height={tile}
					patternUnits="userSpaceOnUse"
					patternTransform={`translate(${offsetX} ${offsetY})`}
				>
					<path
						data-grid-level="major"
						d={paths.major}
						fill="none"
						stroke="var(--grid-major)"
						strokeWidth={MAJOR_STROKE}
						strokeOpacity={detail.major}
					/>
					{detail.mid > 0 && (
						<path
							data-grid-level="minor"
							d={paths.mid}
							fill="none"
							stroke="var(--grid-minor)"
							strokeWidth={MID_STROKE}
							strokeDasharray={MID_DASH}
							strokeOpacity={detail.mid}
						/>
					)}
					{detail.fine > 0 && (
						<path
							data-grid-level="fine"
							d={paths.fine}
							fill="none"
							stroke="var(--grid-fine)"
							strokeWidth={FINE_STROKE}
							strokeOpacity={detail.fine}
						/>
					)}
				</pattern>
			</defs>
			<rect
				x={0}
				y={0}
				width="100%"
				height="100%"
				fill={`url(#${patternId})`}
				pointerEvents="none"
			/>
		</g>
	)
}
