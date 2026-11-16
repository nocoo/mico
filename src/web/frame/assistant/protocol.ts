import { getToolName, isToolUIPart, type UIMessage } from 'ai'

export type AssistantTab = 'chat' | 'audio' | 'live' | 'settings'

export function summaryToolsCompleted(parts: UIMessage['parts']): boolean {
	let htmlDone = false
	let actionsDone = false
	for (const part of parts) {
		if (!isToolUIPart(part)) continue
		const name = getToolName(part)
		const updates =
			name === 'update_shapes' &&
			part.input &&
			typeof part.input === 'object' &&
			'updates' in part.input &&
			Array.isArray(part.input.updates)
				? part.input.updates
				: []
		const updatesHtml = updates.some(
			(update: unknown) =>
				typeof update === 'object' &&
				update !== null &&
				'patch' in update &&
				typeof update.patch === 'object' &&
				update.patch !== null &&
				'html' in update.patch,
		)
		const succeeded =
			part.state === 'output-available' &&
			typeof part.output === 'object' &&
			part.output !== null &&
			'ok' in part.output &&
			part.output.ok === true
		if (name === 'add_html_cards' || updatesHtml) htmlDone = succeeded
		if (name === 'upsert_action_card') actionsDone = succeeded
	}
	return htmlDone && actionsDone
}

export const ASSISTANT_TABS: readonly AssistantTab[] = ['chat', 'audio', 'live', 'settings']
export const DEFAULT_ASSISTANT_TAB: AssistantTab = 'audio'

export function assistantTabs(settingsVisible: boolean): readonly AssistantTab[] {
	return ASSISTANT_TABS.filter((tab) => settingsVisible || tab !== 'settings')
}

export function resolveAssistantTab(tab: AssistantTab, settingsVisible: boolean): AssistantTab {
	return tab === 'settings' && !settingsVisible ? 'chat' : tab
}

export function initialAssistantTab(initialPrompt: string): AssistantTab {
	return initialPrompt.trim() ? 'chat' : DEFAULT_ASSISTANT_TAB
}

export function deriveAssistantActivity({
	error,
	busy,
	summaryRequesting,
	lectureQueued,
	connectionStatus,
}: {
	error: boolean
	busy: boolean
	summaryRequesting: boolean
	lectureQueued: number
	connectionStatus: string
}) {
	if (error) return { state: 'attention', text: 'Mico needs attention' }
	if (summaryRequesting) return { state: 'work', text: 'Mico is creating a session summary…' }
	if (busy) return { state: 'work', text: 'Mico is drawing…' }
	if (lectureQueued > 0) {
		return {
			state: 'work',
			text: `${lectureQueued} segment${lectureQueued === 1 ? '' : 's'} queued`,
		}
	}
	if (connectionStatus === 'offline') return { state: 'offline', text: 'Mico is offline' }
	if (connectionStatus === 'reconnecting') return { state: 'work', text: 'Mico is reconnecting…' }
	return { state: 'idle', text: 'Mico is ready' }
}

export function nextAssistantTab(
	current: AssistantTab,
	key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
	settingsVisible: boolean,
): AssistantTab {
	const tabs = assistantTabs(settingsVisible)
	if (key === 'Home') return tabs[0]
	if (key === 'End') return tabs[tabs.length - 1]
	const index = tabs.indexOf(resolveAssistantTab(current, settingsVisible))
	const direction = key === 'ArrowRight' ? 1 : -1
	return tabs[(index + direction + tabs.length) % tabs.length]
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

export function appendCompletedTranscript(current: string, completed: string): string {
	const transcript = completed.trim()
	if (!transcript) return current
	return current.trim() ? `${current.trim()} ${transcript}` : transcript
}
