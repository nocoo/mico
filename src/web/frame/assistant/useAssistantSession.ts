import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, getToolName, isToolUIPart } from 'ai'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { POST_SESSION_SUMMARY_PROMPT } from '../../../shared/summaryPrompt'
import { type LessonClip, lectureSegmentText } from '../../stt/transcript'
import type { AssistantActions, AssistantState } from '../contracts'
import type { LessonSegment } from './LessonPanel'
import {
	type AssistantTab,
	buildAssistantRequestBody,
	shouldCloseAssistantEscape,
	shouldConsumeInitialPrompt,
	shouldRestoreAssistantTriggerFocus,
	takeLectureBatch,
} from './protocol'

export interface AssistantSessionProps {
	state: AssistantState
	actions: AssistantActions
}

export function useAssistantSession({ state, actions }: AssistantSessionProps) {
	const { close, consumeInitialPrompt, isGestureActive } = actions
	const [tab, setTab] = useState<AssistantTab>('chat')
	const [draft, setDraft] = useState('')
	const panelRef = useRef<HTMLElement>(null)
	const messagesRef = useRef<HTMLDivElement>(null)
	const composerRef = useRef<HTMLTextAreaElement>(null)
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
			const created = message.parts.some((part) => {
				if (!isToolUIPart(part) || part.state !== 'output-available') return false
				const name = getToolName(part)
				if (name === 'add_html_cards') return true
				return name === 'update_shapes' && JSON.stringify(part.input).includes('"html"')
			})
			if (created) setSummaryDone(true)
		},
		onError: () => {
			if (!summaryInFlight.current) return
			summaryInFlight.current = false
			setSummaryRequesting(false)
		},
	})

	const busy = status === 'submitted' || status === 'streaming'

	const resetLectureQueue = useCallback(() => {
		lectureQueue.current = []
		requestSeq.current++
		requestLock.current = false
		summaryAttempted.current = false
		summaryInFlight.current = false
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
		pointerInside.current = true
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			if (!(target instanceof Node)) return
			pointerInside.current = Boolean(
				panelRef.current?.contains(target) ||
					(target instanceof Element && target.closest('[data-ai-toggle="true"]')),
			)
		}
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			const focusInside =
				document.activeElement instanceof Node && panelRef.current?.contains(document.activeElement)
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
		const field = composerRef.current
		if (!field) return
		const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 560
		const timer = window.setTimeout(() => field.focus(), delay)
		return () => window.clearTimeout(timer)
	}, [state.open, tab])

	const continueChat = useCallback(() => {
		if (requestLock.current) return
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
	}, [sendMessage, state.selectedIds, state.canvasId, clearError])

	return {
		tab,
		setTab,
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
