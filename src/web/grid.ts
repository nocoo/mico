export interface GridViewport {
	x: number
	y: number
	zoom: number
}

export const GRID_MAJOR_WORLD = 64
export const GRID_SNAP_WORLD = 16

export const GRID_FADE = {
	majorFull: 32,
	majorZero: 6,
	majorMin: 0.06,
	minorFull: 12,
	minorZero: 3,
} as const

export interface GridSpacing {
	major: number
	minor: number
}

export interface GridDetail {
	major: number
	minor: number
}

export interface GridMetrics {
	tile: number
	offsetX: number
	offsetY: number
	spacing: GridSpacing
	detail: GridDetail
	minorOffsets: number[]
}

export interface GridPathData {
	major: string
	minor: string
}

export function positiveModulo(value: number, modulus: number): number {
	const remainder = value % modulus
	if (remainder === 0) return 0
	return remainder < 0 ? remainder + modulus : remainder
}

function fade(spacing: number, full: number, zero: number): number {
	if (spacing >= full) return 1
	if (spacing <= zero) return 0
	return (spacing - zero) / (full - zero)
}

function minorOffsets(zoom: number): number[] {
	const step = GRID_SNAP_WORLD * zoom
	const divisions = GRID_MAJOR_WORLD / GRID_SNAP_WORLD
	const offsets: number[] = []
	for (let index = 1; index < divisions; index += 1) {
		offsets.push(index * step)
	}
	return offsets
}

export function computeGrid(viewport: GridViewport): GridMetrics {
	const x = viewport?.x
	const y = viewport?.y
	const zoom = viewport?.zoom
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) {
		throw new Error('grid: viewport must have finite pan and zoom values')
	}
	if (zoom <= 0) throw new Error('grid: zoom must be greater than zero')

	const tile = GRID_MAJOR_WORLD * zoom
	const spacing: GridSpacing = {
		major: tile,
		minor: GRID_SNAP_WORLD * zoom,
	}
	const detail: GridDetail = {
		major: Math.max(
			GRID_FADE.majorMin,
			fade(spacing.major, GRID_FADE.majorFull, GRID_FADE.majorZero),
		),
		minor: fade(spacing.minor, GRID_FADE.minorFull, GRID_FADE.minorZero),
	}

	return {
		tile,
		offsetX: positiveModulo(x, tile),
		offsetY: positiveModulo(y, tile),
		spacing,
		detail,
		minorOffsets: minorOffsets(zoom),
	}
}

export function gridPathData(metrics: GridMetrics): GridPathData {
	const { tile, minorOffsets } = metrics
	const major = [`M0 0V${tile}`, `M${tile} 0V${tile}`, `M0 0H${tile}`, `M0 ${tile}H${tile}`].join(
		'',
	)
	const minor = minorOffsets
		.flatMap((offset) => [`M${offset} 0V${tile}`, `M0 ${offset}H${tile}`])
		.join('')
	return { major, minor }
}
