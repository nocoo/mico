export const FRAME_LAYOUT = {
	grid: 4,
	desktopInset: 24,
	mobileInset: 16,
	mobileBreakpoint: 768,
	controlSize: 40,
	iconSize: 20,
} as const

export function dockLeft(viewportWidth: number, dockWidth: number): number {
	return Math.round((viewportWidth - dockWidth) / 2 / FRAME_LAYOUT.grid) * FRAME_LAYOUT.grid
}
