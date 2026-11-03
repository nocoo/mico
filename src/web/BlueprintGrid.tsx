import { useId } from 'react'
import { computeGrid, type GridViewport, gridPathData } from './grid.ts'

const MAJOR_STROKE = 1
const MINOR_STROKE = 0.75
const MINOR_DASH_WORLD = 4

export function BlueprintGrid({ viewport }: { viewport: GridViewport }) {
	const rawId = useId()
	const patternId = `blueprint-grid-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

	const metrics = computeGrid(viewport)
	const { tile, offsetX, offsetY, detail } = metrics
	const paths = gridPathData(metrics)
	const dash = `${MINOR_DASH_WORLD * viewport.zoom} ${MINOR_DASH_WORLD * viewport.zoom}`

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
					{detail.minor > 0 && (
						<path
							data-grid-level="minor"
							d={paths.minor}
							fill="none"
							stroke="var(--grid-minor)"
							strokeWidth={MINOR_STROKE}
							strokeDasharray={dash}
							strokeOpacity={detail.minor}
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
