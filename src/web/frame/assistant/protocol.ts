export type AssistantTab = 'chat' | 'audio' | 'live' | 'settings'

export const ASSISTANT_TABS: readonly AssistantTab[] = ['chat', 'audio', 'live', 'settings']

export function nextAssistantTab(
	current: AssistantTab,
	key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
): AssistantTab {
	if (key === 'Home') return 'chat'
	if (key === 'End') return 'settings'
	const index = ASSISTANT_TABS.indexOf(current)
	const direction = key === 'ArrowRight' ? 1 : -1
	return ASSISTANT_TABS[(index + direction + ASSISTANT_TABS.length) % ASSISTANT_TABS.length]
}

export function takeLectureBatch(queue: readonly string[], maxCount = 3, maxChars = 900) {
	const batch: string[] = []
	let size = 0
	for (const next of queue) {
		if (batch.length >= maxCount) break
		if (batch.length > 0 && size + next.length > maxChars) break
		batch.push(next)
		size += next.length
	}
	return {
		batch,
		remaining: queue.slice(batch.length),
	}
}

export function buildAssistantRequestBody(
	selection: readonly string[],
	mode: 'chat' | 'lecture',
	canvasId: string,
) {
	return {
		selection: [...selection],
		mode,
		...(canvasId ? { canvasId } : {}),
	}
}

export function shouldCloseAssistantEscape(
	key: string,
	gestureActive: boolean,
	pointerInside: boolean,
	focusInside: boolean,
) {
	return key === 'Escape' && !gestureActive && (pointerInside || focusInside)
}

export function shouldRestoreAssistantTriggerFocus(wasOpen: boolean, open: boolean) {
	return wasOpen && !open
}

export function shouldConsumeInitialPrompt(open: boolean, initialPrompt: string) {
	return open && initialPrompt.trim().length > 0
}
