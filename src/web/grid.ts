export interface GridViewport {
	x: number
	y: number
	zoom: number
}

export const GRID_WORLD = 24
export const GRID_MIN_SCREEN = 14
export const GRID_MAX_SCREEN = 56
export const GRID_SNAP_WORLD = 16

export interface GridMetrics {
	spacing: number
	offsetX: number
	offsetY: number
}

export function computeGrid(viewport: GridViewport): GridMetrics {
	const x = viewport?.x
	const y = viewport?.y
	const zoom = viewport?.zoom
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) {
		throw new Error('grid: viewport must have finite pan and zoom values')
	}
	if (zoom <= 0) throw new Error('grid: zoom must be greater than zero')

	let spacing = GRID_WORLD * zoom
	if (!Number.isFinite(spacing)) throw new Error('grid: spacing must be finite')
	while (spacing < GRID_MIN_SCREEN) spacing *= 2
	while (spacing > GRID_MAX_SCREEN) spacing /= 2

	return { spacing, offsetX: x, offsetY: y }
}
