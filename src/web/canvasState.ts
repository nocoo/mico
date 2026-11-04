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
