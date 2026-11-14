import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { FormEvent, KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { POST_SESSION_SUMMARY_PROMPT } from '../../../shared/summaryPrompt'
import { type LessonClip, lectureSegmentText } from '../../stt/transcript'
import { deriveConnectionStatus } from '../connection'
import type { AssistantActions, AssistantState } from '../contracts'
import type { LessonSegment } from './LessonPanel'
import {
	type AssistantTab,
	buildAssistantRequestBody,
	deriveAssistantActivity,
	initialAssistantTab,
	nextAssistantTab,
	shouldCloseAssistantEscape,
	shouldConsumeInitialPrompt,
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
	const [tab, setTab] = useState<AssistantTab>(() => initialAssistantTab(state.initialPrompt))
	const [liveProvider, setLiveProvider] = useState<LiveProvider>(state.mossEnabled ? 'moss' : 'mai')
	const [draft, setDraft] = useState('')
	const panelRef = useRef<HTMLElement>(null)
	const messagesRef = useRef<HTMLDivElement>(null)
	const composerRef = useRef<HTMLTextAreaElement>(null)
	const keyboardTabSelection = useRef(false)
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
	const selectionRef = useRef(state.selectedIds)
	selectionRef.current = state.selectedIds
	const canvasIdRef = useRef(state.canvasId)
	canvasIdRef.current = state.canvasId

	const transport = useMemo(() => new DefaultChatTransport({ api: '/api/ai/chat' }), [])
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
			if (!summaryInFlight.current) return
			summaryInFlight.current = false
			summaryNeedsRecovery.current = true
			setSummaryRequesting(false)
		},
	})

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
		const taken = takeLectureBatch(lectureQueue.current)
		if (taken.batch.length === 0) {
			setLectureQueued(0)
			return
		}
		lectureQueue.current = [...taken.remaining]
		requestLock.current = true
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
			const seq = ++requestSeq.current
			setDraft('')
			void sendMessage(
				{ text: value },
				{
					body: buildAssistantRequestBody(state.selectedIds, 'chat', state.canvasId),
				},
			).finally(() => releaseRequestRef.current(seq))
		},
		[sendMessage, state.selectedIds, status, state.canvasId],
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
		clearError()
		requestLock.current = true
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
	}, [sendMessage, summaryDone, clearError])

	const endSession = useCallback(() => {
		setSessionEnded(true)
	}, [])

	const startMicrophone = useCallback(() => {
		clearError()
		setSessionEnded(false)
		setSummaryDone(false)
		summaryAttempted.current = false
		summaryNeedsRecovery.current = false
	}, [clearError])

	useEffect(() => {
		if (!sessionEnded || error || busy || summaryDone || summaryRequesting) return
		if (summaryAttempted.current || messages.length === 0) return
		if (requestLock.current || lectureQueue.current.length > 0) return
		summaryAttempted.current = true
		requestSummary()
	}, [sessionEnded, error, busy, summaryDone, summaryRequesting, messages.length, requestSummary])

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
		clearError()
		setDraft('')
		resetLectureQueue()
	}, [state.canvasId, stop, setMessages, clearError, resetLectureQueue])

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
		if (!state.open || tab !== 'chat') return
		if (keyboardTabSelection.current) {
			keyboardTabSelection.current = false
			return
		}
		const field = composerRef.current
		if (!field) return
		const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 560
		const timer = window.setTimeout(() => field.focus(), delay)
		return () => window.clearTimeout(timer)
	}, [state.open, tab])

	const focusTab = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
			event.preventDefault()
			const next = nextAssistantTab(tab, event.key as 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End')
			keyboardTabSelection.current = next !== tab && next === 'chat'
			setTab(next)
			document.getElementById(`ai-tab-${next}`)?.focus()
		},
		[tab],
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
		const seq = ++requestSeq.current
		clearError()
		void sendMessage(
			{
				text: 'Continue from the current board. Reuse existing objects and do not repeat earlier work.',
			},
			{
				body: buildAssistantRequestBody(state.selectedIds, 'chat', state.canvasId),
			},
		).finally(() => releaseRequestRef.current(seq))
	}, [sendMessage, state.selectedIds, state.canvasId, clearError, requestSummary])

	return {
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
		clearError,
		continueChat,
		enqueueLecture,
		resetLecture,
		requestSummary,
		endSession,
		startMicrophone,
	}
}

export type AssistantViewModel = ReturnType<typeof useAssistantSession>
