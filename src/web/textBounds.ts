import type { CanvasShape, Shape } from '../shared/types.ts'

interface VisibleTextBounds {
	left: number
	top: number
	right: number
	bottom: number
}

export function deriveTextBounds(shapes: readonly Shape[], root: ParentNode | null): Shape[] {
	const visible = new Map<string, VisibleTextBounds>()

	for (const element of root?.querySelectorAll<HTMLElement>('.typographic-text') ?? []) {
		const id = element.closest('[data-shape-id]')?.getAttribute('data-shape-id')
		if (!id) continue

		const shape = shapes.find(
			(candidate): candidate is CanvasShape => candidate.type === 'text' && candidate.id === id,
		)
		if (!shape) continue

		let height: number
		try {
			height = element.scrollHeight
		} catch {
			continue
		}
		if (!Number.isFinite(height) || height < 0) continue

		let left = shape.x
		let top = shape.y
		let right = shape.x + shape.w
		let bottom = shape.y + Math.max(shape.h, height)

		try {
			const elementRect = element.getBoundingClientRect()
			const range = element.ownerDocument?.createRange()
			if (range && elementRect.width > 0 && elementRect.height > 0) {
				range.selectNodeContents(element)
				const rangeRect = range.getBoundingClientRect()
				if (
					Number.isFinite(rangeRect.left) &&
					Number.isFinite(rangeRect.right) &&
					Number.isFinite(rangeRect.top) &&
					Number.isFinite(rangeRect.bottom)
				) {
					const scaleX = shape.w / elementRect.width
					const scaleY = shape.h / elementRect.height
					left = Math.min(left, shape.x + (rangeRect.left - elementRect.left) * scaleX)
					right = Math.max(right, shape.x + (rangeRect.right - elementRect.left) * scaleX)
					top = Math.min(top, shape.y + (rangeRect.top - elementRect.top) * scaleY)
					bottom = Math.max(bottom, shape.y + (rangeRect.bottom - elementRect.top) * scaleY)
				}
			}
		} catch {}

		try {
			if (Number.isFinite(element.scrollWidth) && element.scrollWidth > shape.w) {
				right = Math.max(right, shape.x + element.scrollWidth)
			}
		} catch {}

		visible.set(id, { left, top, right, bottom })
	}

	for (const element of root?.querySelectorAll<HTMLElement>('.shape-label') ?? []) {
		const id = element.closest('[data-shape-id]')?.getAttribute('data-shape-id')
		if (!id) continue

		const shape = shapes.find(
			(candidate): candidate is CanvasShape =>
				(candidate.type === 'rectangle' || candidate.type === 'ellipse') && candidate.id === id,
		)
		if (!shape) continue

		try {
			const elementRect = element.getBoundingClientRect()
			const range = element.ownerDocument?.createRange()
			if (!range || elementRect.width <= 0 || elementRect.height <= 0) continue
			range.selectNodeContents(element)
			const rangeRect = range.getBoundingClientRect()
			if (
				!Number.isFinite(rangeRect.left) ||
				!Number.isFinite(rangeRect.right) ||
				!Number.isFinite(rangeRect.top) ||
				!Number.isFinite(rangeRect.bottom)
			) {
				continue
			}

			const ellipse = shape.type === 'ellipse'
			const labelWidth = Math.max(1, ellipse ? shape.w / Math.SQRT2 - 24 : shape.w - 24)
			const labelHeight = Math.max(1, ellipse ? shape.h / Math.SQRT2 - 24 : shape.h - 24)
			const labelX = shape.x + (shape.w - labelWidth) / 2
			const labelY = shape.y + (shape.h - labelHeight) / 2

			let worldBounds = {
				left: labelX + (rangeRect.left - elementRect.left) * (labelWidth / elementRect.width),
				right: labelX + (rangeRect.right - elementRect.left) * (labelWidth / elementRect.width),
				top: labelY + (rangeRect.top - elementRect.top) * (labelHeight / elementRect.height),
				bottom: labelY + (rangeRect.bottom - elementRect.top) * (labelHeight / elementRect.height),
			}
			const foreignObject = element.closest(
				'foreignObject',
			) as unknown as SVGForeignObjectElement | null
			const screenMatrix = foreignObject?.getScreenCTM()
			if (screenMatrix) {
				try {
					const inverse = screenMatrix.inverse()
					const corners = [
						new DOMPoint(rangeRect.left, rangeRect.top).matrixTransform(inverse),
						new DOMPoint(rangeRect.right, rangeRect.top).matrixTransform(inverse),
						new DOMPoint(rangeRect.right, rangeRect.bottom).matrixTransform(inverse),
						new DOMPoint(rangeRect.left, rangeRect.bottom).matrixTransform(inverse),
					]
					worldBounds = {
						left: Math.min(...corners.map((point) => point.x)),
						right: Math.max(...corners.map((point) => point.x)),
						top: Math.min(...corners.map((point) => point.y)),
						bottom: Math.max(...corners.map((point) => point.y)),
					}
				} catch {}
			}
			const left = Math.min(shape.x, worldBounds.left)
			const right = Math.max(shape.x + shape.w, worldBounds.right)
			const top = Math.min(shape.y, worldBounds.top)
			const bottom = Math.max(shape.y + shape.h, worldBounds.bottom)
			visible.set(id, { left, top, right, bottom })
		} catch {}
	}

	return shapes.map((shape) => {
		if (shape.type !== 'text' && shape.type !== 'rectangle' && shape.type !== 'ellipse')
			return shape
		const bounds = visible.get(shape.id)
		if (!bounds) return shape

		const left = Math.min(shape.x, bounds.left)
		const top = Math.min(shape.y, bounds.top)
		const right = Math.max(shape.x + shape.w, bounds.right)
		const bottom = Math.max(shape.y + shape.h, bounds.bottom)
		const width = right - left
		const height = bottom - top
		if (left === shape.x && top === shape.y && width === shape.w && height === shape.h) return shape
		return { ...shape, x: left, y: top, w: width, h: height }
	})
}
