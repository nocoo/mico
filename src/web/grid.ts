export interface GridViewport {
	x: number
	y: number
	zoom: number
}

export const GRID_MAJOR_WORLD = 64
export const GRID_MID_WORLD = 32
export const GRID_FINE_WORLD = 8

export const GRID_FADE = {
	majorFull: 32,
	majorZero: 6,
	majorMin: 0.35,
	midFull: 24,
	midZero: 8,
	fineFull: 8,
	fineZero: 4,
} as const

export interface GridSpacing {
	major: number
	mid: number
	fine: number
}

export interface GridDetail {
	major: number
	mid: number
	fine: number
}

export interface GridMetrics {
	tile: number
	offsetX: number
	offsetY: number
	spacing: GridSpacing
	detail: GridDetail
	midOffset: number
	fineOffsets: number[]
}

export interface GridPathData {
	major: string
	mid: string
	fine: string
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

function fineFractions(): number[] {
	const divisions = GRID_MAJOR_WORLD / GRID_FINE_WORLD
	const midpoint = GRID_MID_WORLD / GRID_FINE_WORLD
	const fractions: number[] = []
	for (let index = 1; index < divisions; index += 1) {
		if (index === midpoint) continue
		fractions.push(index / divisions)
	}
	return fractions
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
		mid: GRID_MID_WORLD * zoom,
		fine: GRID_FINE_WORLD * zoom,
	}
	const detail: GridDetail = {
		major: Math.max(
			GRID_FADE.majorMin,
			fade(spacing.major, GRID_FADE.majorFull, GRID_FADE.majorZero),
		),
		mid: fade(spacing.mid, GRID_FADE.midFull, GRID_FADE.midZero),
		fine: fade(spacing.fine, GRID_FADE.fineFull, GRID_FADE.fineZero),
	}

	return {
		tile,
		offsetX: positiveModulo(x, tile),
		offsetY: positiveModulo(y, tile),
		spacing,
		detail,
		midOffset: GRID_MID_WORLD * zoom,
		fineOffsets: fineFractions().map((fraction) => fraction * tile),
	}
}

export function gridPathData(metrics: GridMetrics): GridPathData {
	const { tile, midOffset, fineOffsets } = metrics
	const major = [`M0 0V${tile}`, `M${tile} 0V${tile}`, `M0 0H${tile}`, `M0 ${tile}H${tile}`].join(
		'',
	)
	const mid = [`M${midOffset} 0V${tile}`, `M0 ${midOffset}H${tile}`].join('')
	const fine = fineOffsets
		.flatMap((offset) => [`M${offset} 0V${tile}`, `M0 ${offset}H${tile}`])
		.join('')
	return { major, mid, fine }
}
