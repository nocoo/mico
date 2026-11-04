import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const round = Number(process.argv[2] ?? 1)
const dir = join('evals', 'runs', `round${round}`)

interface Point {
	x: number
	y: number
}

interface Shape {
	id: string
	type: string
	x?: number
	y?: number
	w?: number
	h?: number
	text?: string
	title?: string
	frameId?: string
	from?: string
	to?: string
	points?: Point[]
}

interface Rect {
	x: number
	y: number
	w: number
	h: number
}

interface Tool {
	name: string
	state: string
	output?: string
	error?: string
	failed?: boolean
	input?: string
}

interface Segment {
	index: number
	text: string
	elapsedMs: number
	timedOut: boolean
	error?: string
	textReply: string
	waits: boolean
	tools: Tool[]
}

interface CaseLog {
	case: { id: string; title: string; lang: string }
	canvasId: string
	canvasName: string
	segments: Segment[]
	summary?: Segment
	finalBoard?: { shapes: Shape[] }
	stats: Record<string, unknown>
	error?: string
}

function bounds(shape: Shape): Rect | null {
	if (shape.type === 'connector') return null
	if (typeof shape.x !== 'number' || typeof shape.y !== 'number') return null
	const w = shape.w ?? 0
	const h = shape.h ?? 0
	return {
		x: Math.min(shape.x, shape.x + w),
		y: Math.min(shape.y, shape.y + h),
		w: Math.abs(w),
		h: Math.abs(h),
	}
}

function overlap(a: Rect, b: Rect): number {
	const left = Math.max(a.x, b.x)
	const top = Math.max(a.y, b.y)
	const right = Math.min(a.x + a.w, b.x + b.w)
	const bottom = Math.min(a.y + a.h, b.y + b.h)
	if (right <= left || bottom <= top) return 0
	const area = (right - left) * (bottom - top)
	const minArea = Math.min(a.w * a.h, b.w * b.h)
	return minArea > 0 ? area / minArea : 0
}

function contains(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x - 1 &&
		inner.y >= outer.y - 1 &&
		inner.x + inner.w <= outer.x + outer.w + 1 &&
		inner.y + inner.h <= outer.y + outer.h + 1
	)
}

function analyzeCase(log: CaseLog) {
	const shapes = log.finalBoard?.shapes ?? []
	const rects = new Map<string, Rect>()
	for (const shape of shapes) {
		const rect = bounds(shape)
		if (rect) rects.set(shape.id, rect)
	}
	const frames = new Map(
		shapes.filter((shape) => shape.type === 'frame').map((shape) => [shape.id, bounds(shape)]),
	)
	const overlapPairs: { a: string; b: string; ratio: number }[] = []
	let overlapCount = 0
	const content = shapes.filter((shape) =>
		['rectangle', 'ellipse', 'note', 'html'].includes(shape.type),
	)
	for (let i = 0; i < content.length; i++) {
		for (let j = i + 1; j < content.length; j++) {
			const a = rects.get(content[i].id)
			const b = rects.get(content[j].id)
			if (!a || !b) continue
			const ratio = overlap(a, b)
			if (ratio > 0.35) {
				overlapCount++
				if (overlapPairs.length < 12) {
					overlapPairs.push({ a: content[i].id, b: content[j].id, ratio })
				}
			}
		}
	}
	const frameOverlaps: { a: string; b: string; ratio: number }[] = []
	let frameOverlapCount = 0
	const frameList = [...frames.entries()].filter(([, rect]) => rect)
	for (let i = 0; i < frameList.length; i++) {
		for (let j = i + 1; j < frameList.length; j++) {
			const ratio = overlap(frameList[i][1] as Rect, frameList[j][1] as Rect)
			if (ratio > 0.05) {
				frameOverlapCount++
				if (frameOverlaps.length < 8) {
					frameOverlaps.push({ a: frameList[i][0], b: frameList[j][0], ratio })
				}
			}
		}
	}
	const outsideFrames = shapes
		.filter((shape) => shape.frameId)
		.filter((shape) => {
			const frame = frames.get(shape.frameId as string)
			const rect = rects.get(shape.id)
			return !frame || !rect || !contains(frame, rect)
		})
		.map((shape) => shape.id)
	const longLabels = shapes
		.filter((shape) => ['rectangle', 'ellipse'].includes(shape.type) && shape.text)
		.filter((shape) => {
			const rect = rects.get(shape.id)
			if (!rect) return false
			const capacity = Math.max(1, (rect.w / 14) * (rect.h / 18))
			return (shape.text as string).length > capacity * 1.3
		})
		.map((shape) => shape.id)
	const toolErrors = [...log.segments, ...(log.summary ? [log.summary] : [])].flatMap((segment) =>
		segment.tools
			.filter((tool) => tool.failed)
			.map((tool) => ({
				segment: segment.index,
				tool: tool.name,
				error: tool.error ?? tool.output,
			})),
	)
	const summaryTools = log.summary?.tools ?? []
	return {
		id: log.case.id,
		title: log.case.title,
		canvas: log.canvasName,
		segments: log.segments.length,
		waits: log.segments.filter((segment) => segment.waits).length,
		timeouts: log.segments.filter((segment) => segment.timedOut).length,
		avgSegmentMs: Math.round(
			log.segments.reduce((sum, segment) => sum + segment.elapsedMs, 0) /
				Math.max(1, log.segments.length),
		),
		summaryHtml:
			shapes.some((shape) => shape.type === 'html') &&
			summaryTools.some(
				(tool) =>
					tool.name === 'add_html_cards' && tool.state === 'output-available' && !tool.failed,
			),
		summaryMs: log.summary?.elapsedMs ?? null,
		shapes: shapes.length,
		shapeTypes: shapes.reduce<Record<string, number>>((counts, shape) => {
			counts[shape.type] = (counts[shape.type] ?? 0) + 1
			return counts
		}, {}),
		htmlCards: shapes.filter((shape) => shape.type === 'html').length,
		overlapCount,
		overlapPairs,
		frameOverlapCount,
		frameOverlaps,
		outsideFrames,
		longLabels,
		toolErrors,
		error: log.error,
	}
}

interface SummaryCase {
	id: string
	title?: string
	canvas?: string
	canvasId?: string
	error?: string
}

let summaryCases: SummaryCase[] | null = null
try {
	const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as {
		cases?: SummaryCase[]
	}
	summaryCases = summary.cases ?? null
} catch {
	summaryCases = null
}

const cases: ReturnType<typeof analyzeCase>[] = []
const failures: { id: string; title?: string; error: string }[] = []
if (summaryCases) {
	for (const entry of summaryCases) {
		if (entry.error || !entry.canvasId) {
			failures.push({ id: entry.id, title: entry.title, error: entry.error ?? 'missing canvas' })
			continue
		}
		try {
			const log = JSON.parse(readFileSync(join(dir, `${entry.id}.json`), 'utf8')) as CaseLog
			cases.push(analyzeCase(log))
		} catch {
			failures.push({ id: entry.id, title: entry.title, error: 'missing or invalid case log' })
		}
	}
} else {
	const generated = new Set(['summary.json', 'analysis.json'])
	const files = readdirSync(dir).filter((file) => file.endsWith('.json') && !generated.has(file))
	for (const file of files) {
		const log = JSON.parse(readFileSync(join(dir, file), 'utf8')) as CaseLog
		cases.push(analyzeCase(log))
	}
}

const analysis = {
	round,
	failures,
	cases,
	totals: {
		cases: cases.length,
		failedCases: failures.length,
		segments: cases.reduce((sum, item) => sum + item.segments, 0),
		shapes: cases.reduce((sum, item) => sum + item.shapes, 0),
		htmlCards: cases.reduce((sum, item) => sum + item.htmlCards, 0),
		waits: cases.reduce((sum, item) => sum + item.waits, 0),
		toolErrors: cases.reduce((sum, item) => sum + item.toolErrors.length, 0),
		overlapPairs: cases.reduce((sum, item) => sum + item.overlapCount, 0),
		frameOverlapPairs: cases.reduce((sum, item) => sum + item.frameOverlapCount, 0),
		outsideFrames: cases.reduce((sum, item) => sum + item.outsideFrames.length, 0),
		longLabels: cases.reduce((sum, item) => sum + item.longLabels.length, 0),
		summariesMissingHtml: cases.filter((item) => !item.summaryHtml).length,
	},
}
writeFileSync(join(dir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`)

const lines = [
	`# Round ${round} analysis`,
	'',
	`Cases: ${analysis.totals.cases}; failed: ${analysis.totals.failedCases}; segments: ${analysis.totals.segments}; shapes: ${analysis.totals.shapes}; HTML cards: ${analysis.totals.htmlCards}; WAIT: ${analysis.totals.waits}; tool errors: ${analysis.totals.toolErrors}; content overlaps: ${analysis.totals.overlapPairs}; frame overlaps: ${analysis.totals.frameOverlapPairs}; outside frames: ${analysis.totals.outsideFrames}; long labels: ${analysis.totals.longLabels}; summaries missing HTML: ${analysis.totals.summariesMissingHtml}.`,
	'',
	'| case | segments | avg ms | shapes | html | summary html | tool errors | content overlaps | frame overlaps | outside frames | long labels |',
	'| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
]
for (const item of cases) {
	lines.push(
		`| ${item.id} | ${item.segments} | ${item.avgSegmentMs} | ${item.shapes} | ${item.htmlCards} | ${item.summaryHtml ? 'yes' : 'NO'} | ${item.toolErrors.length} | ${item.overlapCount} | ${item.frameOverlapCount} | ${item.outsideFrames.length} | ${item.longLabels.length} |`,
	)
}
for (const item of cases) {
	lines.push('', `## ${item.id}`, '')
	if (item.toolErrors.length) {
		lines.push('Tool errors:')
		for (const error of item.toolErrors) {
			lines.push(`- segment ${error.segment} ${error.tool}: ${String(error.error).slice(0, 300)}`)
		}
	}
	if (item.overlapPairs.length) {
		lines.push(
			`Overlaps: ${item.overlapPairs.map((pair) => `${pair.a}/${pair.b} ${(pair.ratio * 100).toFixed(0)}%`).join(', ')}`,
		)
	}
	if (item.frameOverlaps.length) {
		lines.push(
			`Frame overlaps: ${item.frameOverlaps.map((pair) => `${pair.a}/${pair.b} ${(pair.ratio * 100).toFixed(0)}%`).join(', ')}`,
		)
	}
	if (item.outsideFrames.length) lines.push(`Outside frames: ${item.outsideFrames.join(', ')}`)
	if (item.longLabels.length) lines.push(`Possible overflow labels: ${item.longLabels.join(', ')}`)
}
writeFileSync(join(dir, 'ANALYSIS.md'), `${lines.join('\n')}\n`)
console.log(JSON.stringify(analysis.totals, null, 2))
