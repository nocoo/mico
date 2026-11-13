import type {
	OverviewCanvasSize,
	OverviewProjection,
	OverviewViewport,
} from '../../shared/overview.ts'
import {
	canvasViewportRect,
	overviewPointToWorld,
	viewportCenteredOn,
} from '../../shared/overview.ts'

export function viewportAfterOverviewDrag(
	projection: OverviewProjection,
	viewport: OverviewViewport,
	canvas: OverviewCanvasSize,
	from: { x: number; y: number },
	to: { x: number; y: number },
): OverviewViewport {
	const visible = canvasViewportRect(viewport, canvas)
	const start = overviewPointToWorld(projection, from.x, from.y)
	const end = overviewPointToWorld(projection, to.x, to.y)
	return viewportCenteredOn(viewport, canvas, {
		x: (visible.left + visible.right) / 2 + end.x - start.x,
		y: (visible.top + visible.bottom) / 2 + end.y - start.y,
	})
}
