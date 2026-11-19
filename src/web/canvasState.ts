import type { Board, CanvasSummary } from '../shared/types.ts'

function isNewer(a: CanvasSummary, b: CanvasSummary): boolean {
	if (a.revision !== b.revision) return a.revision > b.revision
	return a.updatedAt >= b.updatedAt
}

export function rememberBoard(cache: Map<string, Board>, canvasId: string, board: Board): void {
	if (!canvasId) return
	const current = cache.get(canvasId)
	if (!current || board.revision >= current.revision) cache.set(canvasId, board)
}

function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
	const left = a as Record<string, unknown>
	const right = b as Record<string, unknown>
	const keys = Object.keys(left)
	return (
		keys.length === Object.keys(right).length &&
		keys.every((key) => sameValue(left[key], right[key]))
	)
}

export function shouldApplyBoard(current: Board, next: Board): boolean {
	if (next.revision > current.revision) return true
	if (next.revision < current.revision) return false
	if (current === next) return false
	if (current.shapes.length !== next.shapes.length) return true
	return !current.shapes.every((shape, index) => sameValue(shape, next.shapes[index]))
}

export function mergeSnapshotCanvases(
	current: CanvasSummary[],
	incoming: CanvasSummary[],
): CanvasSummary[] {
	const byId = new Map(current.map((canvas) => [canvas.id, canvas]))
	return incoming
		.map((next) => {
			const previous = byId.get(next.id)
			if (!previous) return next
			const chosen = isNewer(next, previous) ? next : previous
			return {
				...chosen,
				preview: chosen.preview ?? previous.preview ?? next.preview,
			}
		})
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision)
}

export function upsertCanvasSummary(
	current: CanvasSummary[],
	summary: CanvasSummary,
): CanvasSummary[] {
	const previous = current.find((canvas) => canvas.id === summary.id)
	let next = summary
	if (previous) {
		if (isNewer(summary, previous)) {
			next = {
				...summary,
				name: previous.name,
				createdAt: previous.createdAt,
				preview: summary.preview ?? previous.preview,
			}
		} else {
			next = { ...previous, preview: previous.preview ?? summary.preview }
		}
	}
	const canvases = previous
		? current.map((canvas) => (canvas.id === summary.id ? next : canvas))
		: [...current, next]
	return canvases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision)
}
