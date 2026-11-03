import type { CanvasShape, Point, Shape } from '../shared/types.ts'
import { GRID_SNAP_WORLD } from './grid.ts'

export interface AlignmentGuide {
	axis: 'x' | 'y'
	value: number
	from: number
	to: number
}

export interface SnapResult {
	x: number
	y: number
	guides: AlignmentGuide[]
}

const ALIGN_THRESHOLD_SCREEN = 6
const NEIGHBOR_RADIUS_SCREEN = 160
const DISTANCE_EPSILON = 1e-9
const FEATURE_EPSILON = 1e-6

type FeatureKind = 'start' | 'end' | 'center'

interface Bounds {
	left: number
	right: number
	top: number
	bottom: number
}

interface Peer {
	bounds: Bounds
}

interface Alignment {
	origin: number
	value: number
	kind: FeatureKind
	distance: number
	rank: number
}

function boundsOf(x: number, y: number, w: number, h: number): Bounds {
	return {
		left: Math.min(x, x + w),
		right: Math.max(x, x + w),
		top: Math.min(y, y + h),
		bottom: Math.max(y, y + h),
	}
}

function peerFeature(bounds: Bounds, axis: 'x' | 'y', kind: FeatureKind): number {
	if (axis === 'x') {
		if (kind === 'start') return bounds.left
		if (kind === 'end') return bounds.right
		return (bounds.left + bounds.right) / 2
	}
	if (kind === 'start') return bounds.top
	if (kind === 'end') return bounds.bottom
	return (bounds.top + bounds.bottom) / 2
}

function movedOffset(size: number, kind: FeatureKind): number {
	if (kind === 'start') return Math.min(0, size)
	if (kind === 'end') return Math.max(0, size)
	return size / 2
}

function rankOf(kind: FeatureKind, peerKind: FeatureKind): number {
	if (kind === 'center') return 1
	if (kind === peerKind) return 0
	return 2
}

function isBetter(distance: number, rank: number, best: Alignment): boolean {
	if (Math.abs(distance - best.distance) > DISTANCE_EPSILON) return distance < best.distance
	return rank < best.rank
}

function isNearby(moving: Bounds, peer: Bounds, zoom: number): boolean {
	const dx = Math.max(0, Math.max(moving.left, peer.left) - Math.min(moving.right, peer.right))
	const dy = Math.max(0, Math.max(moving.top, peer.top) - Math.min(moving.bottom, peer.bottom))
	return Math.hypot(dx, dy) * zoom <= NEIGHBOR_RADIUS_SCREEN
}

function alignAxis(
	axis: 'x' | 'y',
	size: number,
	rawOrigin: number,
	peers: Peer[],
	zoom: number,
): Alignment | undefined {
	const kinds: FeatureKind[] = ['start', 'end', 'center']
	let best: Alignment | undefined
	for (const peer of peers) {
		for (const kind of kinds) {
			const peerKinds: FeatureKind[] = kind === 'center' ? ['center'] : ['start', 'end']
			for (const peerKind of peerKinds) {
				const value = peerFeature(peer.bounds, axis, peerKind)
				const origin = value - movedOffset(size, kind)
				const distance = Math.abs(origin - rawOrigin)
				if (distance * zoom > ALIGN_THRESHOLD_SCREEN) continue
				const rank = rankOf(kind, peerKind)
				if (!best || isBetter(distance, rank, best)) {
					best = { origin, value, kind, distance, rank }
				}
			}
		}
	}
	return best
}

function matchesFeature(
	bounds: Bounds,
	axis: 'x' | 'y',
	value: number,
	kind: FeatureKind,
): boolean {
	if (kind === 'center') {
		return Math.abs(peerFeature(bounds, axis, 'center') - value) <= FEATURE_EPSILON
	}
	const start = peerFeature(bounds, axis, 'start')
	const end = peerFeature(bounds, axis, 'end')
	return Math.abs(start - value) <= FEATURE_EPSILON || Math.abs(end - value) <= FEATURE_EPSILON
}

function snapToGrid(value: number): number {
	return Math.round(value / GRID_SNAP_WORLD) * GRID_SNAP_WORLD + 0
}

function buildGuide(
	axis: 'x' | 'y',
	alignment: Alignment,
	peers: Peer[],
	moved: Bounds,
): AlignmentGuide {
	const matching = peers.filter((peer) =>
		matchesFeature(peer.bounds, axis, alignment.value, alignment.kind),
	)
	if (axis === 'x') {
		const from = Math.min(moved.top, ...matching.map((peer) => peer.bounds.top))
		const to = Math.max(moved.bottom, ...matching.map((peer) => peer.bounds.bottom))
		return { axis: 'x', value: alignment.value, from, to }
	}
	const from = Math.min(moved.left, ...matching.map((peer) => peer.bounds.left))
	const to = Math.max(moved.right, ...matching.map((peer) => peer.bounds.right))
	return { axis: 'y', value: alignment.value, from, to }
}

export function snapMove(
	shape: CanvasShape,
	position: Point,
	shapes: Shape[],
	zoom: number,
): SnapResult {
	if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
		throw new RangeError('snap: position must have finite x and y')
	}
	if (!Number.isFinite(zoom) || zoom <= 0) {
		throw new RangeError('snap: zoom must be a finite number greater than zero')
	}
	if (!Number.isFinite(shape?.w) || !Number.isFinite(shape?.h)) {
		throw new RangeError('snap: shape width and height must be finite')
	}

	const moving = boundsOf(position.x, position.y, shape.w, shape.h)
	const peers: Peer[] = []
	for (const candidate of shapes) {
		if (!candidate || candidate.type === 'connector') continue
		if (candidate.id === shape.id) continue
		if (
			!Number.isFinite(candidate.x) ||
			!Number.isFinite(candidate.y) ||
			!Number.isFinite(candidate.w) ||
			!Number.isFinite(candidate.h)
		) {
			continue
		}
		const bounds = boundsOf(candidate.x, candidate.y, candidate.w, candidate.h)
		if (!isNearby(moving, bounds, zoom)) continue
		peers.push({ bounds })
	}

	const xAlign = alignAxis('x', shape.w, position.x, peers, zoom)
	const yAlign = alignAxis('y', shape.h, position.y, peers, zoom)
	const x = xAlign ? xAlign.origin : snapToGrid(position.x)
	const y = yAlign ? yAlign.origin : snapToGrid(position.y)

	const guides: AlignmentGuide[] = []
	const moved = boundsOf(x, y, shape.w, shape.h)
	if (xAlign) guides.push(buildGuide('x', xAlign, peers, moved))
	if (yAlign) guides.push(buildGuide('y', yAlign, peers, moved))

	return { x, y, guides }
}
