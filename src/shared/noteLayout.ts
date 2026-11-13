export const NOTE_LABEL_SPACE = 19
export const NOTE_BASE_VERTICAL_SPACE = 31
export const NOTE_MIN_LABELED_HEIGHT = NOTE_BASE_VERTICAL_SPACE + NOTE_LABEL_SPACE

export function hasVisibleNoteLabel(label: string | undefined): boolean {
	return label !== undefined && label.length > 0
}

export function noteLabelHeightDelta(
	before: string | undefined,
	after: string | undefined,
): number {
	const change = Number(hasVisibleNoteLabel(after)) - Number(hasVisibleNoteLabel(before))
	return change * NOTE_LABEL_SPACE
}
