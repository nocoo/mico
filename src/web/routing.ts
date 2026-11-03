import type { CanvasShape } from '../shared/types.ts'
import { getAnchorNormal, getAnchors, type Point } from './anchors.ts'

interface Bounds {
	left: number
	top: number
	right: number
	bottom: number
}

interface Obstacle {
	shape: CanvasShape
	box: Bounds
}

function obstacle(shape: CanvasShape, padding: number): Obstacle | null {
	if (shape.type === 'line' || !shape.w || !shape.h) return null
	return {
		shape,
		box: {
			left: shape.x - padding,
			top: shape.y - padding,
			right: shape.x + shape.w + padding,
			bottom: shape.y + shape.h + padding,
		},
	}
}

function outsidePoint(shape: CanvasShape, anchor: Point, index: number, padding: number): Point {
	if (!obstacle(shape, 0)) return anchor
	const normal = getAnchorNormal(shape, index)
	const minimum =
		Math.max(1, Math.abs(anchor.x), Math.abs(anchor.y), shape.w, shape.h) * Number.EPSILON * 32
	const distance = Math.max(padding, minimum)
	return { x: anchor.x + normal.x * distance, y: anchor.y + normal.y * distance }
}

function crossesInterior(a: Point, b: Point, item: Obstacle): boolean {
	const { shape, box } = item
	const dx = b.x - a.x
	const dy = b.y - a.y
	if (shape.type === 'ellipse') {
		const rx = (box.right - box.left) / 2
		const ry = (box.bottom - box.top) / 2
		const x = (a.x - (box.left + box.right) / 2) / rx
		const y = (a.y - (box.top + box.bottom) / 2) / ry
		const vx = dx / rx
		const vy = dy / ry
		const length = vx * vx + vy * vy
		const t = length ? Math.max(0, Math.min(1, -(x * vx + y * vy) / length)) : 0
		return (x + vx * t) ** 2 + (y + vy * t) ** 2 < 1 - 1e-12
	}
	let low = 0
	let high = 1
	for (const [position, delta, min, max] of [
		[a.x, dx, box.left, box.right],
		[a.y, dy, box.top, box.bottom],
	]) {
		if (delta === 0) {
			if (position <= min || position >= max) return false
			continue
		}
		const first = (min - position) / delta
		const last = (max - position) / delta
		low = Math.max(low, Math.min(first, last))
		high = Math.min(high, Math.max(first, last))
		if (low >= high) return false
	}
	return low < high && high > 0 && low < 1
}

function shortestRoute(
	points: Point[],
	first: Point,
	last: Point,
	obstacles: Obstacle[],
	orthogonal: boolean,
): Point[] | null {
	const available = points.filter(
		(point) => !obstacles.some((item) => crossesInterior(point, point, item)),
	)
	const startIndex = available.findIndex((point) => point.x === first.x && point.y === first.y)
	const endIndex = available.findIndex((point) => point.x === last.x && point.y === last.y)
	if (startIndex < 0 || endIndex < 0) return null
	const distances = available.map(() => Infinity)
	const previous = available.map(() => -1)
	const visited = new Set<number>()
	distances[startIndex] = 0
	while (visited.size < available.length) {
		let current = -1
		for (let index = 0; index < available.length; index++) {
			if (!visited.has(index) && (current < 0 || distances[index] < distances[current]))
				current = index
		}
		if (current < 0 || !Number.isFinite(distances[current]) || current === endIndex) break
		visited.add(current)
		for (let next = 0; next < available.length; next++) {
			if (
				visited.has(next) ||
				(orthogonal &&
					available[current].x !== available[next].x &&
					available[current].y !== available[next].y)
			)
				continue
			if (obstacles.some((item) => crossesInterior(available[current], available[next], item)))
				continue
			const distance =
				distances[current] +
				Math.hypot(
					available[current].x - available[next].x,
					available[current].y - available[next].y,
				)
			if (distance < distances[next]) {
				distances[next] = distance
				previous[next] = current
			}
		}
	}
	if (!Number.isFinite(distances[endIndex])) return null
	const route: Point[] = []
	for (let index = endIndex; index !== -1; index = previous[index]) route.push(available[index])
	return route.reverse()
}

function routeWithPadding(
	from: CanvasShape,
	to: CanvasShape,
	start: Point,
	end: Point,
	fromIndex: number,
	toIndex: number,
	padding: number,
): Point[] | null {
	const first = outsidePoint(from, start, fromIndex, padding)
	const last = outsidePoint(to, end, toIndex, padding)
	const fromObstacle = obstacle(from, padding / 2)
	const toObstacle = obstacle(to, padding / 2)
	if (
		(toObstacle && crossesInterior(start, first, toObstacle)) ||
		(fromObstacle && crossesInterior(last, end, fromObstacle))
	)
		return null
	const obstacles = [fromObstacle, toObstacle].filter((item): item is Obstacle => item !== null)
	const offsets =
		padding > 0 && padding <= 1
			? [-16, -8, -4, -2, -1, 1, 2, 4, 8, 16].map((step) => step * padding)
			: []
	const xs = [
		...new Set([
			first.x,
			last.x,
			...obstacles.flatMap(({ box }) => [box.left, box.right]),
			...offsets.flatMap((offset) => [first.x + offset, last.x + offset]),
		]),
	]
	const ys = [
		...new Set([
			first.y,
			last.y,
			...obstacles.flatMap(({ box }) => [box.top, box.bottom]),
			...offsets.flatMap((offset) => [first.y + offset, last.y + offset]),
		]),
	]
	const points = xs.flatMap((x) => ys.map((y) => ({ x, y })))
	const route = shortestRoute(points, first, last, obstacles, true)
	return route ? [start, ...route, end] : null
}

function routeWithVisibility(
	from: CanvasShape,
	to: CanvasShape,
	start: Point,
	end: Point,
	fromIndex: number,
	toIndex: number,
	segments: number,
): Point[] | null {
	const first = outsidePoint(from, start, fromIndex, 0)
	const last = outsidePoint(to, end, toIndex, 0)
	const fromObstacle = obstacle(from, 0)
	const toObstacle = obstacle(to, 0)
	if (
		(toObstacle && crossesInterior(start, first, toObstacle)) ||
		(fromObstacle && crossesInterior(last, end, fromObstacle))
	)
		return null
	const obstacles = [fromObstacle, toObstacle].filter((item): item is Obstacle => item !== null)
	const points: Point[] = [first, last]
	for (const { shape, box } of obstacles) {
		if (shape.type === 'ellipse') {
			const scale = 1 / Math.cos(Math.PI / segments)
			for (let index = 0; index < segments; index++) {
				const angle = ((index + 0.5) * 2 * Math.PI) / segments
				points.push({
					x: shape.x + shape.w / 2 + (Math.cos(angle) * shape.w * scale) / 2,
					y: shape.y + shape.h / 2 + (Math.sin(angle) * shape.h * scale) / 2,
				})
			}
		} else {
			points.push(
				{ x: box.left, y: box.top },
				{ x: box.right, y: box.top },
				{ x: box.left, y: box.bottom },
				{ x: box.right, y: box.bottom },
			)
		}
	}
	const route = shortestRoute(points, first, last, obstacles, false)
	return route ? [start, ...route, end] : null
}

export function getConnectorRoute(
	from: CanvasShape,
	to: CanvasShape,
	start: Point,
	end: Point,
	fromAnchor?: number,
	toAnchor?: number,
): Point[] {
	const fromIndex =
		fromAnchor ?? getAnchors(from).findIndex((point) => point.x === start.x && point.y === start.y)
	const toIndex =
		toAnchor ?? getAnchors(to).findIndex((point) => point.x === end.x && point.y === end.y)
	if (fromIndex < 0 || toIndex < 0) return [start, end]

	const fromNormal = getAnchorNormal(from, fromIndex)
	const toNormal = getAnchorNormal(to, toIndex)
	const dx = end.x - start.x
	const dy = end.y - start.y
	const fromOutward =
		from.type === 'line' || !from.w || !from.h || fromNormal.x * dx + fromNormal.y * dy > 1e-9
	const toOutward =
		to.type === 'line' || !to.w || !to.h || toNormal.x * -dx + toNormal.y * -dy > 1e-9
	if (fromOutward && toOutward) return [start, end]

	for (const padding of [16, 4, 1, 0.25, 0.0625, 0.015625, 0]) {
		const route = routeWithPadding(from, to, start, end, fromIndex, toIndex, padding)
		if (route) return route
	}
	for (const segments of [48, 96, 192, 384]) {
		const route = routeWithVisibility(from, to, start, end, fromIndex, toIndex, segments)
		if (route) return route
	}
	return [start, end]
}
