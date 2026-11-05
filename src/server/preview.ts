import { Buffer } from 'node:buffer'
import type { CanvasShape, Point, Shape } from '../shared/types.ts'
import { CANDY_COLORS, CANDY_LAYOUT } from '../web/design.ts'

export const PREVIEW_WIDTH = 160
export const PREVIEW_HEIGHT = 100

const PADDING = 8
const MAX_SCALE = 1.5
const MAX_PREVIEW_SHAPES = 240
const MAX_PREVIEW_POINTS = 64

function xmlSafe(value: string): string {
	let safe = ''
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0
		if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue
		if (code === 0xfffe || code === 0xffff) continue
		safe += character
	}
	return safe
}

function escapeXml(value: string): string {
	return xmlSafe(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}

function geometry(shape: CanvasShape) {
	const left = Math.min(shape.x, shape.x + shape.w)
	const top = Math.min(shape.y, shape.y + shape.h)
	return {
		x: left,
		y: top,
		w: Math.abs(shape.w),
		h: Math.abs(shape.h),
		cx: left + Math.abs(shape.w) / 2,
		cy: top + Math.abs(shape.h) / 2,
	}
}

function previewBounds(shapes: Shape[]) {
	let left = Number.POSITIVE_INFINITY
	let top = Number.POSITIVE_INFINITY
	let right = Number.NEGATIVE_INFINITY
	let bottom = Number.NEGATIVE_INFINITY
	for (const shape of shapes) {
		if (shape.type === 'connector') continue
		const box = geometry(shape)
		left = Math.min(left, box.x)
		top = Math.min(top, box.y)
		right = Math.max(right, box.x + box.w)
		bottom = Math.max(bottom, box.y + box.h)
	}
	if (!Number.isFinite(left)) return null
	return { left, top, right, bottom, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }
}

function pointsFor(shape: CanvasShape): Point[] {
	return (shape.points ?? []).map((point) => ({ x: shape.x + point.x, y: shape.y + point.y }))
}

function shapeArt(shape: Shape, transform: (point: Point) => Point, scale: number): string {
	if (shape.type === 'connector') return ''
	const box = geometry(shape)
	const topLeft = transform({ x: box.x, y: box.y })
	const width = Math.max(2, box.w * scale)
	const height = Math.max(2, box.h * scale)
	if (shape.type === 'frame') {
		return `<rect x="${topLeft.x}" y="${topLeft.y}" width="${width}" height="${height}" rx="4" fill="${escapeXml(shape.color)}" fill-opacity="0.07" stroke="${escapeXml(shape.color)}" stroke-opacity="0.35"/>`
	}
	if (shape.type === 'note') {
		const label = (shape.text ?? '').slice(0, 18)
		const text = label
			? `<text x="${topLeft.x + 3}" y="${topLeft.y + 8}" font-family="Inter, system-ui, sans-serif" font-size="5" fill="${CANDY_COLORS.ink}">${escapeXml(label)}</text>`
			: ''
		return `<rect x="${topLeft.x}" y="${topLeft.y}" width="${width}" height="${height}" rx="3" fill="${escapeXml(shape.color)}"/>${text}`
	}
	if (shape.type === 'html') {
		return `<rect x="${topLeft.x}" y="${topLeft.y}" width="${width}" height="${height}" rx="4" fill="${escapeXml(shape.color)}" fill-opacity="0.1" stroke="${escapeXml(shape.color)}" stroke-opacity="0.45"/>`
	}
	if (shape.type === 'image') {
		const color = escapeXml(shape.color)
		return `<rect x="${topLeft.x}" y="${topLeft.y}" width="${width}" height="${height}" rx="2" fill="${color}" fill-opacity="0.1" stroke="${color}" stroke-opacity="0.45"/><path d="M${topLeft.x} ${topLeft.y + height} L${topLeft.x + width * 0.4} ${topLeft.y + height * 0.4} L${topLeft.x + width} ${topLeft.y + height}" fill="${color}" fill-opacity="0.2"/>`
	}
	if (shape.type === 'rectangle' || shape.type === 'ellipse') {
		const label = (shape.text ?? '').slice(0, 24)
		const size = Math.min(9, Math.max(4, 14 * scale))
		const text = label
			? `<text x="${topLeft.x + width / 2}" y="${topLeft.y + height / 2}" font-family="Inter, system-ui, sans-serif" font-size="${size}" fill="${CANDY_COLORS.ink}" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>`
			: ''
		const body =
			shape.type === 'rectangle'
				? `<rect x="${topLeft.x}" y="${topLeft.y}" width="${width}" height="${height}" rx="3" fill="${escapeXml(shape.color)}" fill-opacity="0.12" stroke="${escapeXml(shape.color)}" stroke-width="1.5"/>`
				: `<ellipse cx="${topLeft.x + width / 2}" cy="${topLeft.y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${escapeXml(shape.color)}" fill-opacity="0.12" stroke="${escapeXml(shape.color)}" stroke-width="1.5"/>`
		return body + text
	}
	if (shape.type === 'text') {
		const size = Math.min(12, Math.max(4, (shape.fontSize ?? 24) * scale))
		const label = (shape.text ?? '').slice(0, 48)
		if (!label) return ''
		return `<text x="${topLeft.x}" y="${topLeft.y + size}" font-family="Inter, system-ui, sans-serif" font-size="${size}" fill="${escapeXml(shape.color)}">${escapeXml(label)}</text>`
	}
	if (shape.type === 'line') {
		const start = transform({ x: shape.x, y: shape.y })
		const end = transform({ x: shape.x + shape.w, y: shape.y + shape.h })
		return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${escapeXml(shape.color)}" stroke-width="1.5"/>`
	}
	if (shape.type === 'path') {
		const all = pointsFor(shape)
		if (all.length < 2) return ''
		const step = Math.max(1, Math.ceil((all.length - 1) / (MAX_PREVIEW_POINTS - 1)))
		const sampled = all.filter(
			(_, index) => index === 0 || index === all.length - 1 || index % step === 0,
		)
		const points = sampled.map(transform)
		const d = points
			.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
			.join(' ')
		return `<path d="${d}" fill="none" stroke="${escapeXml(shape.color)}" stroke-width="${Math.max(1, (shape.strokeWidth ?? 2) * scale)}" stroke-linecap="round" stroke-linejoin="round"/>`
	}
	return ''
}

export function canvasPreview(shapes: Shape[]): string {
	const bounds = previewBounds(shapes)
	const background = `<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="${CANDY_LAYOUT.canvas}"/>`
	let content = ''
	if (bounds) {
		const scale = Math.min(
			MAX_SCALE,
			(PREVIEW_WIDTH - PADDING * 2) / bounds.w,
			(PREVIEW_HEIGHT - PADDING * 2) / bounds.h,
		)
		const offsetX = PREVIEW_WIDTH / 2 - ((bounds.left + bounds.right) / 2) * scale
		const offsetY = PREVIEW_HEIGHT / 2 - ((bounds.top + bounds.bottom) / 2) * scale
		const transform = (point: Point): Point => ({
			x: point.x * scale + offsetX,
			y: point.y * scale + offsetY,
		})
		const ordered = [
			...shapes.filter((shape) => shape.type === 'frame'),
			...shapes.filter((shape) => shape.type === 'note'),
			...shapes.filter(
				(shape) => shape.type !== 'connector' && shape.type !== 'frame' && shape.type !== 'note',
			),
			...shapes.filter((shape) => shape.type === 'connector'),
		].slice(0, MAX_PREVIEW_SHAPES)
		content = ordered
			.map((shape) => {
				if (shape.type !== 'connector') return shapeArt(shape, transform, scale)
				const from = shapes.find((candidate) => candidate.id === shape.from)
				const to = shapes.find((candidate) => candidate.id === shape.to)
				if (!from || from.type === 'connector' || !to || to.type === 'connector') return ''
				const fromBox = geometry(from)
				const toBox = geometry(to)
				const a = transform({ x: fromBox.cx, y: fromBox.cy })
				const b = transform({ x: toBox.cx, y: toBox.cy })
				return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${escapeXml(shape.color)}" stroke-opacity="0.8" stroke-width="1"/>`
			})
			.join('')
	}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">${background}<rect x="0.5" y="0.5" width="${PREVIEW_WIDTH - 1}" height="${PREVIEW_HEIGHT - 1}" rx="6" fill="none" stroke="${CANDY_LAYOUT.border}"/>${content}</svg>`
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
