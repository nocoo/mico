export function shouldShowEmptyState(
	canvasId: string,
	shapeCount: number,
	dismissedCanvasId: string,
	initialPrompt: string,
): boolean {
	return Boolean(canvasId) && shapeCount === 0 && dismissedCanvasId !== canvasId && !initialPrompt
}
