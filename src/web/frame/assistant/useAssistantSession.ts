import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { FormEvent, KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compactUiMessages } from '../../../shared/conversationCompact'
import { POST_SESSION_SUMMARY_PROMPT } from '../../../shared/summaryPrompt'
import { type LessonClip, lectureSegmentText } from '../../stt/transcript'
import { canvasFetch } from '../../whiteboards/client'
import { deriveConnectionStatus } from '../connection'
import type { AssistantActions, AssistantState } from '../contracts'
import type { LessonSegment } from './LessonPanel'
import {
	type AssistantTab,
	assistantTabs,
	buildAssistantRequestBody,
	DEFAULT_ASSISTANT_TAB,
	deriveAssistantActivity,
	nextAssistantTab,
	resolveAssistantTab,
	shouldAutoRequestSummary,
	shouldCloseAssistantEscape,
	shouldConsumeInitialPrompt,
	shouldFocusComposer,
	shouldRestoreAssistantTriggerFocus,
	summaryToolsCompleted,
	takeLectureBatch,
} from './protocol'

export interface AssistantSessionProps {
	state: AssistantState
	actions: AssistantActions
}

export type LiveProvider = 'moss' | 'mai'

export function useAssistantSession({ state, actions }: AssistantSessionProps) {
	const { close, consumeInitialPrompt, isGestureActive } = actions
	const [selectedTab, setSelectedTab] = useState<AssistantTab>(DEFAULT_ASSISTANT_TAB)
	const tabs = assistantTabs(state.aiSettingsVisible)
	const tab = resolveAssistantTab(selectedTab, state.aiSettingsVisible)
	const setTab = useCallback(
		(next: AssistantTab) => {
			setSelectedTab(resolveAssistantTab(next, state.aiSettingsVisible))
		},
		[state.aiSettingsVisible],
	)
	const [liveProvider, setLiveProvider] = useState<LiveProvider>(state.mossEnabled ? 'moss' : 'mai')
	const [draft, setDraft] = useState('')
	const panelRef = useRef<HTMLElement>(null)
	const messagesRef = useRef<HTMLDivElement>(null)
	const composerRef = useRef<HTMLTextAreaElement>(null)
	const composerWasOpenRef = useRef(state.open)
	const pointerInside = useRef(false)
	const wasOpen = useRef(false)
	const lastCanvasId = useRef(state.canvasId)
	const lectureQueue = useRef<string[]>([])
	const requestLock = useRef(false)
	const requestSeq = useRef(0)
	const releaseRequestRef = useRef<(seq: number) => void>(() => {})
	const [lectureQueued, setLectureQueued] = useState(0)
	const [lessonClipId, setLessonClipId] = useState('')
	const [sessionEnded, setSessionEnded] = useState(false)
	const [summaryDone, setSummaryDone] = useState(false)
	const [summaryRequesting, setSummaryRequesting] = useState(false)
	const summaryAttempted = useRef(false)
	const summaryInFlight = useRef(false)
	const summaryNeedsRecovery = useRef(false)
	const activeRequestSource = useRef<'lecture' | 'summary' | 'chat'>('chat')
	const [lastErrorSource, setLastErrorSource] = useState<'lecture' | 'summary' | 'chat' | null>(
		null,
	)
	const sessionEndedRef = useRef(sessionEnded)
	sessionEndedRef.current = sessionEnded
	const selectionRef = useRef(state.selectedIds)
	selectionRef.current = state.selectedIds
	const canvasIdRef = useRef(state.canvasId)
	canvasIdRef.current = state.canvasId

	const transport = useMemo(
		() =>
			new DefaultChatTransport({
				api: '/api/ai/chat',
				fetch: canvasFetch,
				prepareSendMessagesRequest: ({ id, messages, trigger, messageId, body }) => ({
					body: {
						...body,
						id,
						messages: compactUiMessages(messages),
						trigger,
						messageId,
					},
				}),
			}),
		[],
	)
	const { messages, setMessages, sendMessage, status, error, stop, clearError } = useChat({
		transport,
		throttle: 40,
		onFinish: ({ message }) => {
			if (!summaryInFlight.current) return
			summaryInFlight.current = false
			setSummaryRequesting(false)
			if (summaryToolsCompleted(message.parts)) setSummaryDone(true)
		},
		onError: () => {
			setLastErrorSource(activeRequestSource.current)
			if (!summaryInFlight.current) return
			summaryInFlight.current = false
			summaryNeedsRecovery.current = true
			setSummaryRequesting(false)
		},
	})

	const clearSessionError = useCallback(() => {
		setLastErrorSource(null)
		clearError()
	}, [clearError])

	const busy = status === 'submitted' || status === 'streaming'
	const connection = deriveConnectionStatus(state.connection)
	const activity = deriveAssistantActivity({
		error: Boolean(error),
		busy,
		summaryRequesting,
		lectureQueued,
		connectionStatus: connection.status,
	})

	const resetLectureQueue = useCallback(() => {
		lectureQueue.current = []
		requestSeq.current++
		requestLock.current = false
		summaryAttempted.current = false
		summaryInFlight.current = false
		summaryNeedsRecovery.current = false
		sessionEndedRef.current = false
		setLastErrorSource(null)
		setLectureQueued(0)
		setSessionEnded(false)
		setSummaryDone(false)
		setSummaryRequesting(false)
	}, [])

	useEffect(
		() => () => {
			lectureQueue.current = []
			requestSeq.current++
			requestLock.current = false
		},
		[],
	)

	const pumpLecture = useCallback(() => {
		if (requestLock.current) return
		const taken = takeLectureBatch(lectureQueue.current, undefined, undefined, {
			flushAll: sessionEndedRef.current,
		})
		if (taken.batch.length === 0) {
			setLectureQueued(0)
			return
		}
		lectureQueue.current = [...taken.remaining]
		requestLock.current = true
		activeRequestSource.current = 'lecture'
		setLastErrorSource(null)
		const seq = ++requestSeq.current
		setLectureQueued(lectureQueue.current.length)
		void sendMessage(
			{ text: taken.batch.join('\n\n') },
			{
				body: buildAssistantRequestBody(selectionRef.current, 'lecture', canvasIdRef.current),
			},
		).finally(() => releaseRequestRef.current(seq))
	}, [sendMessage])

	releaseRequestRef.current = (seq) => {
		if (requestSeq.current !== seq) return
		requestLock.current = false
		pumpLecture()
	}

	const send = useCallback(
		(text: string) => {
			const value = text.trim()
			if (!value || requestLock.current || status === 'submitted' || status === 'streaming') return
			summaryNeedsRecovery.current = false
			requestLock.current = true
			activeRequestSource.current = 'chat'
			clearSessionError()
			const seq = ++requestSeq.current
			setDraft('')
			void sendMessage(
				{ text: value },
				{
					body: buildAssistantRequestBody(state.selectedIds, 'chat', state.canvasId),
				},
			).finally(() => releaseRequestRef.current(seq))
		},
		[sendMessage, state.selectedIds, status, state.canvasId, clearSessionError],
	)

	const submit = (event?: FormEvent) => {
		event?.preventDefault()
		if (busy) return
		send(draft)
	}

	useEffect(() => {
		if (!shouldConsumeInitialPrompt(state.open, state.initialPrompt)) return
		const timer = window.setTimeout(() => {
			setDraft(state.initialPrompt)
			consumeInitialPrompt()
			send(state.initialPrompt)
		}, 0)
		return () => window.clearTimeout(timer)
	}, [state.open, state.initialPrompt, consumeInitialPrompt, send])

	const enqueueLecture = useCallback(
		(segment: LessonSegment, clip: Pick<LessonClip, 'subject' | 'title'>) => {
			lectureQueue.current.push(
				lectureSegmentText(clip, segment.id, segment.start, segment.end, segment.text),
			)
			setLectureQueued(lectureQueue.current.length)
			pumpLecture()
		},
		[pumpLecture],
	)

	const requestSummary = useCallback(() => {
		if (requestLock.current || summaryInFlight.current || summaryDone) return
		clearSessionError()
		requestLock.current = true
		activeRequestSource.current = 'summary'
		summaryInFlight.current = true
		summaryNeedsRecovery.current = false
		summaryAttempted.current = true
		setSummaryRequesting(true)
		const seq = ++requestSeq.current
		void sendMessage(
			{ text: POST_SESSION_SUMMARY_PROMPT },
			{
				body: buildAssistantRequestBody(selectionRef.current, 'chat', canvasIdRef.current),
			},
		).finally(() => releaseRequestRef.current(seq))
	}, [sendMessage, summaryDone, clearSessionError])

	const endSession = useCallback(() => {
		sessionEndedRef.current = true
		setSessionEnded(true)
		pumpLecture()
	}, [pumpLecture])

	const startMicrophone = useCallback(() => {
		clearSessionError()
		sessionEndedRef.current = false
		setSessionEnded(false)
		setSummaryDone(false)
		summaryAttempted.current = false
		summaryNeedsRecovery.current = false
	}, [clearSessionError])

	useEffect(() => {
		if (
			!shouldAutoRequestSummary({
				sessionEnded,
				error: Boolean(error),
				lastErrorSource,
				busy,
				summaryDone,
				summaryRequesting,
				summaryAttempted: summaryAttempted.current,
				messagesLength: messages.length,
				requestLock: requestLock.current,
				queueLength: lectureQueue.current.length,
			})
		) {
			return
		}
		summaryAttempted.current = true
		requestSummary()
	}, [
		sessionEnded,
		error,
		lastErrorSource,
		busy,
		summaryDone,
		summaryRequesting,
		messages.length,
		requestSummary,
	])

	const resetLecture = useCallback(() => {
		resetLectureQueue()
		if (status === 'submitted' || status === 'streaming') stop()
	}, [resetLectureQueue, status, stop])

	useEffect(() => {
		if (lastCanvasId.current === state.canvasId) return
		const previous = lastCanvasId.current
		lastCanvasId.current = state.canvasId
		if (!previous || !state.canvasId) return
		stop()
		setMessages([])
		clearSessionError()
		setDraft('')
		resetLectureQueue()
	}, [state.canvasId, stop, setMessages, clearSessionError, resetLectureQueue])

	useEffect(() => {
		if (!state.open) return
		pointerInside.current = false
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			if (!(target instanceof Node)) return
			pointerInside.current = Boolean(
				panelRef.current?.contains(target) ||
					(target instanceof Element && target.closest('[data-ai-toggle="true"]')),
			)
		}
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			const focused = document.activeElement
			const focusInside =
				focused instanceof Element &&
				(panelRef.current?.contains(focused) || focused.closest('[data-ai-toggle="true"]'))
			if (
				shouldCloseAssistantEscape(
					event.key,
					isGestureActive(),
					pointerInside.current,
					Boolean(focusInside),
				)
			) {
				event.stopPropagation()
				close()
			}
		}
		document.addEventListener('pointerdown', onPointerDown, true)
		document.addEventListener('keydown', onKeyDown, true)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true)
			document.removeEventListener('keydown', onKeyDown, true)
		}
	}, [state.open, close, isGestureActive])

	useEffect(() => {
		if (shouldRestoreAssistantTriggerFocus(wasOpen.current, state.open)) {
			document.querySelector<HTMLButtonElement>('[data-ai-toggle="true"]')?.focus()
		}
		wasOpen.current = state.open
	}, [state.open])

	// biome-ignore lint/correctness/useExhaustiveDependencies: new messages and a re-shown log must scroll to the end
	useEffect(() => {
		const list = messagesRef.current
		if (!list) return
		list.scrollTop = list.scrollHeight
	}, [messages, status, state.open, tab])

	useEffect(() => {
		if (!state.open || tab !== 'chat') return
		const field = composerRef.current
		if (!field) return
		field.style.height = 'auto'
		field.style.height = `${Math.min(field.scrollHeight, 120)}px`
	}, [state.open, tab])

	useEffect(() => {
		const focusComposer = shouldFocusComposer(composerWasOpenRef.current, state.open, tab)
		composerWasOpenRef.current = state.open
		if (!focusComposer) return
		const field = composerRef.current
		if (!field) return
		const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 560
		const timer = window.setTimeout(() => {
			const active = document.activeElement
			if (active && active !== document.body && !panelRef.current?.contains(active)) return
			field.focus()
		}, delay)
		return () => window.clearTimeout(timer)
	}, [state.open, tab])

	const focusTab = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
			event.preventDefault()
			const next = nextAssistantTab(
				tab,
				event.key as 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
				state.aiSettingsVisible,
			)
			setTab(next)
			document.getElementById(`ai-tab-${next}`)?.focus()
		},
		[tab, setTab, state.aiSettingsVisible],
	)

	const selectLiveProvider = useCallback(
		(value: string) => {
			if (value === 'mai') setLiveProvider('mai')
			if (value === 'moss' && state.mossEnabled) setLiveProvider('moss')
		},
		[state.mossEnabled],
	)

	useEffect(() => {
		if (!state.mossEnabled) setLiveProvider('mai')
	}, [state.mossEnabled])

	const continueChat = useCallback(() => {
		if (requestLock.current) return
		if (summaryNeedsRecovery.current) {
			requestSummary()
			return
		}
		requestLock.current = true
		activeRequestSource.current = 'chat'
		clearSessionError()
		const seq = ++requestSeq.current
		void sendMessage(
			{
				text: 'Continue from the current board. Reuse existing objects and do not repeat earlier work.',
			},
			{
				body: buildAssistantRequestBody(state.selectedIds, 'chat', state.canvasId),
			},
		).finally(() => releaseRequestRef.current(seq))
	}, [sendMessage, state.selectedIds, state.canvasId, clearSessionError, requestSummary])

	return {
		tabs,
		tab,
		setTab,
		focusTab,
		connection,
		activity,
		liveProvider,
		selectLiveProvider,
		draft,
		setDraft,
		panelRef,
		messagesRef,
		composerRef,
		messages,
		status,
		error,
		busy,
		sessionEnded,
		summaryDone,
		summaryRequesting,
		lectureQueued,
		lessonClipId,
		setLessonClipId,
		submit,
		send,
		stop,
		clearError: clearSessionError,
		continueChat,
		enqueueLecture,
		resetLecture,
		requestSummary,
		endSession,
		startMicrophone,
	}
}

export type AssistantViewModel = ReturnType<typeof useAssistantSession>
