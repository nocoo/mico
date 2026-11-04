export function formatDuration(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds))
	return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}
