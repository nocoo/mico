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
export const DEFAULT_ASSISTANT_TAB: AssistantTab = 'chat'

export function assistantTabs(settingsVisible: boolean): readonly AssistantTab[] {
	return ASSISTANT_TABS.filter((tab) => settingsVisible || tab !== 'settings')
}

export function resolveAssistantTab(tab: AssistantTab, settingsVisible: boolean): AssistantTab {
	return tab === 'settings' && !settingsVisible ? 'chat' : tab
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

const LOW_SIGNAL_FILLER_CLAUSE =
	/^(?:嗯+|啊+|哦+|唉+|诶+|呃+|好的|好哒|好吧|好呀|好|收到|明白|了解|知道了|没问题|没啥问题|行|对|对的|对对|是的|可以|那行|谢谢|多谢|感谢|uh-huh|uh huh|uh|um+|hmm+|ah+|oh+|yeah|yep|yup|ok|okay|got it|makes sense|sure|right|alright|all right|sounds good|thank you|thanks)$/i

export function isLowSignalSegment(text: string): boolean {
	const trimmed = text.trim()
	if (!trimmed) return true
	if (/\d/.test(trimmed)) return false
	if (/议题|话题|主题|总结|conclusion|summary|topic|agenda/i.test(trimmed)) return false
	const clauses = trimmed
		.split(/[\s,，.。!！?？;；:：、…~—]+/)
		.map((part) => part.trim())
		.filter(Boolean)
	if (clauses.length === 0) return true
	if (clauses.length === 1 && clauses[0].length <= 1) return true
	if (clauses.length > 6 || trimmed.length > 32) return false
	for (let index = 0; index < clauses.length; index++) {
		if (LOW_SIGNAL_FILLER_CLAUSE.test(clauses[index])) continue
		if (
			index + 1 < clauses.length &&
			LOW_SIGNAL_FILLER_CLAUSE.test(`${clauses[index]} ${clauses[index + 1]}`)
		) {
			index++
			continue
		}
		return false
	}
	return true
}

export function takeLectureBatch(
	queue: readonly string[],
	maxCount?: number,
	maxChars?: number,
	options?: { flushAll?: boolean },
) {
	const limitCount =
		maxCount ??
		(maxChars !== undefined
			? 3
			: options?.flushAll || queue.length >= 8
				? 8
				: queue.length >= 4
					? 6
					: 3)
	const limitChars =
		maxChars ??
		(maxCount !== undefined
			? 900
			: options?.flushAll || queue.length >= 8
				? 3200
				: queue.length >= 4
					? 2400
					: 1200)
	const batch: string[] = []
	let size = 0
	for (const next of queue) {
		if (batch.length >= limitCount) break
		if (batch.length > 0 && size + next.length > limitChars) break
		batch.push(next)
		size += next.length
	}
	return {
		batch,
		remaining: queue.slice(batch.length),
	}
}

export function shouldAutoRequestSummary(state: {
	sessionEnded: boolean
	error: boolean
	lastErrorSource: 'lecture' | 'summary' | 'chat' | null
	busy: boolean
	summaryDone: boolean
	summaryRequesting: boolean
	summaryAttempted: boolean
	messagesLength: number
	requestLock: boolean
	queueLength: number
}): boolean {
	if (!state.sessionEnded || state.busy || state.summaryDone || state.summaryRequesting) {
		return false
	}
	if (state.summaryAttempted || state.messagesLength === 0) return false
	if (state.requestLock || state.queueLength > 0) return false
	if (state.error && state.lastErrorSource !== 'lecture') return false
	return true
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

export function shouldFocusComposer(wasOpen: boolean, open: boolean, tab: AssistantTab): boolean {
	return !wasOpen && open && tab === 'chat'
}

export function appendCompletedTranscript(current: string, completed: string): string {
	const transcript = completed.trim()
	if (!transcript) return current
	return current.trim() ? `${current.trim()} ${transcript}` : transcript
}
