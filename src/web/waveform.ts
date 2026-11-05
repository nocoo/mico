import { CANDY_COLORS, CANDY_LAYOUT } from '../shared/palette.ts'

export interface WaveformBucket {
	min: number
	max: number
}

export function buildWaveformBuckets(
	peaks: Float32Array | null,
	bucketCount: number,
): WaveformBucket[] {
	if (!peaks || peaks.length < 2 || bucketCount < 1) return []

	const sourceCount = Math.floor(peaks.length / 2)
	if (sourceCount < 1) return []
	const count = Math.min(bucketCount, sourceCount)
	const buckets: WaveformBucket[] = []

	for (let bucket = 0; bucket < count; bucket++) {
		const start = Math.floor((bucket * sourceCount) / count)
		const end = Math.max(start + 1, Math.floor(((bucket + 1) * sourceCount) / count))
		let min = 0
		let max = 0
		let found = false

		for (let source = start; source < end && source < sourceCount; source++) {
			const sourceMin = peaks[source * 2]
			const sourceMax = peaks[source * 2 + 1]
			if (!Number.isFinite(sourceMin) || !Number.isFinite(sourceMax) || sourceMin > sourceMax)
				continue
			const clampedMin = Math.max(-1, Math.min(1, sourceMin))
			const clampedMax = Math.max(-1, Math.min(1, sourceMax))
			if (!found) {
				min = clampedMin
				max = clampedMax
				found = true
				continue
			}
			min = Math.min(min, clampedMin)
			max = Math.max(max, clampedMax)
		}

		buckets.push({ min, max })
	}

	return buckets
}

export function drawWave(
	canvas: HTMLCanvasElement,
	peaks: Float32Array | null,
	progress: number,
	segments: readonly { end: number }[],
	duration: number,
): void {
	const rect = canvas.getBoundingClientRect()
	const width = Math.max(0, Math.round(canvas.clientWidth || rect.width))
	const height = Math.max(0, Math.round(canvas.clientHeight || rect.height))
	if (width < 1 || height < 1) return

	const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
	const pixelWidth = Math.round(width * dpr)
	const pixelHeight = Math.round(height * dpr)
	if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
		canvas.width = pixelWidth
		canvas.height = pixelHeight
	}

	const ctx = canvas.getContext('2d')
	if (!ctx) return
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
	ctx.clearRect(0, 0, width, height)

	const mid = height / 2
	ctx.globalAlpha = 0.7
	ctx.fillStyle = CANDY_LAYOUT.border
	ctx.fillRect(0, Math.round(mid), width, 1)
	ctx.globalAlpha = 1

	const buckets = buildWaveformBuckets(peaks, Math.max(1, Math.floor(width / 2)))
	if (buckets.length === 0) return

	const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0
	const safeProgress = Number.isFinite(progress) ? Math.max(0, progress) : 0
	const played = safeDuration > 0 ? Math.min(1, safeProgress / safeDuration) * width : 0
	const step = width / buckets.length
	const barWidth = Math.min(2, Math.max(0.8, step * 0.58))
	const amplitude = mid * 0.82

	for (let bucket = 0; bucket < buckets.length; bucket++) {
		const x = bucket * step
		const top = mid - buckets[bucket].max * amplitude
		const bottom = mid - buckets[bucket].min * amplitude
		const barTop = Math.max(0, Math.min(top, bottom))
		const barBottom = Math.min(height, Math.max(top, bottom))
		const barHeight = Math.max(1, barBottom - barTop)
		ctx.globalAlpha = x <= played ? 0.92 : 0.58
		ctx.fillStyle = x <= played ? CANDY_COLORS.blue : CANDY_LAYOUT.inkMuted
		ctx.fillRect(x, barTop, barWidth, barHeight)
	}
	ctx.globalAlpha = 1

	if (safeDuration > 0) {
		const marked = new Set<number>()
		for (const segment of segments) {
			if (!Number.isFinite(segment.end) || segment.end <= 0 || segment.end >= safeDuration) continue
			const markerX = Math.max(1, Math.min(width - 1, (segment.end / safeDuration) * width))
			const key = Math.round(markerX)
			if (marked.has(key)) continue
			marked.add(key)
			ctx.fillStyle = CANDY_LAYOUT.blueStroke
			ctx.fillRect(markerX - 0.5, mid - 5, 1, 10)
		}

		ctx.fillStyle = CANDY_COLORS.blue
		ctx.fillRect(played - 0.75, 3, 1.5, height - 6)
	}
}
