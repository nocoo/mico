import type { BrushStyle, Point } from '../shared/types.ts'

export interface StrokePath {
	d: string
	mode: 'stroke' | 'fill'
}

const round = (value: number) => Math.round(value * 100) / 100

function validate(points: Point[], strokeWidth: number, brush: BrushStyle): void {
	if (!Array.isArray(points)) throw new RangeError('brush: points must be an array')
	for (const point of points) {
		if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
			throw new RangeError('brush: points must have finite coordinates')
		}
	}
	if (!Number.isFinite(strokeWidth) || strokeWidth < 1 || strokeWidth > 64) {
		throw new RangeError('brush: strokeWidth must be between 1 and 64')
	}
	if (brush !== 'pencil' && brush !== 'marker' && brush !== 'brush') {
		throw new RangeError('brush: unknown brush style')
	}
}

function uniquePoints(points: Point[]): Point[] {
	const result: Point[] = []
	for (const point of points) {
		const last = result[result.length - 1]
		if (!last || last.x !== point.x || last.y !== point.y) result.push({ x: point.x, y: point.y })
	}
	return result
}

export function simplifyPoints(points: Point[], minDistance: number): Point[] {
	if (!Array.isArray(points)) throw new RangeError('brush: points must be an array')
	if (!Number.isFinite(minDistance) || minDistance < 0) {
		throw new RangeError('brush: minDistance must be a non-negative number')
	}
	if (points.length <= 2) return points.map((point) => ({ x: point.x, y: point.y }))
	const result = [{ x: points[0].x, y: points[0].y }]
	for (const point of points.slice(1, -1)) {
		const last = result[result.length - 1]
		if (Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) {
			result.push({ x: point.x, y: point.y })
		}
	}
	const end = points[points.length - 1]
	const last = result[result.length - 1]
	if (Math.hypot(end.x - last.x, end.y - last.y) < minDistance && result.length > 1) {
		result[result.length - 1] = { x: end.x, y: end.y }
	} else {
		result.push({ x: end.x, y: end.y })
	}
	return result
}

export function buildStroke(points: Point[], strokeWidth: number, brush: BrushStyle): StrokePath {
	validate(points, strokeWidth, brush)
	const unique = uniquePoints(points)
	if (unique.length < 2) throw new RangeError('brush: a stroke needs at least two distinct points')

	if (brush !== 'brush') {
		return {
			mode: 'stroke',
			d: unique
				.map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
				.join(''),
		}
	}

	const lengths = [0]
	for (let index = 1; index < unique.length; index += 1) {
		lengths.push(
			lengths[index - 1] +
				Math.hypot(unique[index].x - unique[index - 1].x, unique[index].y - unique[index - 1].y),
		)
	}
	const total = lengths[lengths.length - 1]
	const left: string[] = []
	const right: string[] = []
	for (const [index, point] of unique.entries()) {
		const previous = unique[Math.max(0, index - 1)]
		const next = unique[Math.min(unique.length - 1, index + 1)]
		const dx = next.x - previous.x
		const dy = next.y - previous.y
		const length = Math.hypot(dx, dy) || 1
		const nx = -dy / length
		const ny = dx / length
		const t = total === 0 ? 0.5 : lengths[index] / total
		const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.55
		const half = Math.max(0.4, (strokeWidth / 2) * (0.3 + 0.7 * taper))
		left.push(`${round(point.x + nx * half)} ${round(point.y + ny * half)}`)
		right.push(`${round(point.x - nx * half)} ${round(point.y - ny * half)}`)
	}
	const d = `M${left[0]}${left
		.slice(1)
		.map((point) => `L${point}`)
		.join('')}${right
		.reverse()
		.map((point) => `L${point}`)
		.join('')}Z`
	return { mode: 'fill', d }
}
