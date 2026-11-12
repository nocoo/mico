import type { ConnectorVisualGeometry } from './connectorGeometry'

export function ConnectorHead({
	geometry,
	interactive,
}: {
	geometry: ConnectorVisualGeometry
	interactive: boolean
}) {
	if (!geometry.showArrow) return null
	const angle =
		(Math.atan2(geometry.arrowTip.y - geometry.end.y, geometry.arrowTip.x - geometry.end.x) * 180) /
		Math.PI
	return (
		<path
			className="e-head"
			d="M0 0L-10 -5.5L-10 5.5Z"
			transform={`translate(${geometry.arrowTip.x} ${geometry.arrowTip.y}) rotate(${angle})`}
			fill="currentColor"
			stroke="currentColor"
			strokeWidth={2.5}
			strokeLinejoin="round"
			pointerEvents={interactive ? 'visiblePainted' : 'none'}
		/>
	)
}
