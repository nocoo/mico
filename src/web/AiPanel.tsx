import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from 'ai'
import {
	ArrowUp,
	AudioLines,
	Check,
	Hourglass,
	LoaderCircle,
	MessageSquare,
	Mic,
	MousePointer2,
	PlayCircle,
	Square,
	TriangleAlert,
	X,
} from 'lucide-react'
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { POST_SESSION_SUMMARY_PROMPT } from '../shared/summaryPrompt'
import { formatDuration } from './aiAudio'
import { IconButton } from './IconButton'
import { LessonPanel, type LessonSegment } from './LessonPanel'
import { isWaitReply, type LessonClip, lectureSegmentText } from './stt/transcript'

interface AiPanelProps {
	open: boolean
	onClose: () => void
	isGestureActive: () => boolean
	selectedIds: string[]
	onClearSelection: () => void
	initialPrompt?: string
	onInitialPromptConsumed: () => void
	canvasId: string
	onCreateCanvas: (name: string) => void
}

type AiTab = 'chat' | 'lesson' | 'audio'

const WAVE_BARS = [0, 1, 2, 3, 4, 5, 6]

const QUICK_PROMPTS = [
	{
		label: 'Projectile motion',
		prompt: 'Explain projectile motion and draw a complete, labelled diagram step by step.',
	},
	{
		label: 'Acid–base titration',
		prompt: 'Explain acid–base titration and draw the apparatus, the pH curve and the key points.',
	},
	{
		label: 'Quadratic functions',
		prompt:
			'Explain quadratic functions and draw a parabola with its key points and transformations.',
	},
	{
		label: 'Electrolysis of water',
		prompt: 'Explain the electrolysis of water and draw the cell, electrodes and half-reactions.',
	},
] as const

const TOOL_LABELS: Record<string, string> = {
	get_board: 'Inspecting the board',
	add_texts: 'Adding labels',
	add_notes: 'Writing notes',
	add_boxes: 'Drawing shapes',
	add_lines: 'Drawing lines',
	add_connectors: 'Connecting objects',
	add_frames: 'Building frames',
	add_strokes: 'Sketching curves',
	add_html_cards: 'Building a rich card',
	update_shapes: 'Adjusting the layout',
	delete_shapes: 'Removing mistakes',
}

const COUNT_KEYS: Record<string, string> = {
	add_texts: 'texts',
	add_notes: 'notes',
	add_boxes: 'boxes',
	add_lines: 'lines',
	add_connectors: 'connectors',
	add_frames: 'frames',
	add_strokes: 'strokes',
	add_html_cards: 'cards',
	update_shapes: 'updates',
	delete_shapes: 'ids',
}

function resizeComposer(field: HTMLTextAreaElement) {
	field.style.height = 'auto'
	field.style.height = `${Math.min(field.scrollHeight, 120)}px`
}

function toolLabel(name: string, input: unknown): string {
	const base = TOOL_LABELS[name] ?? name.replaceAll('_', ' ')
	const key = COUNT_KEYS[name]
	if (!key || typeof input !== 'object' || input === null) return base
	const list = (input as Record<string, unknown>)[key]
	if (!Array.isArray(list) || list.length === 0) return base
	return `${base} · ${list.length}`
}

function toolFailed(part: { state: string; output?: unknown; errorText?: string }): boolean {
	if (part.state === 'output-error') return true
	if (part.state !== 'output-available') return false
	const output = part.output as { ok?: boolean } | null
	return Boolean(output && output.ok === false)
}

function ChatText({ text }: { text: string }) {
	const cleaned = text.replaceAll('\\(', '').replaceAll('\\)', '')
	let key = 0
	const nodes = cleaned.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((chunk) => {
		const nodeKey = `${key++}`
		if (chunk.startsWith('**') && chunk.endsWith('**')) {
			return <strong key={nodeKey}>{chunk.slice(2, -2)}</strong>
		}
		if (chunk.startsWith('`') && chunk.endsWith('`')) {
			return <code key={nodeKey}>{chunk.slice(1, -1)}</code>
		}
		return chunk
	})
	return <p className="ai-message-text">{nodes}</p>
}

function AssistantMessage({ message }: { message: UIMessage }) {
	const text = message.parts
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join('\n')
	const hasTools = message.parts.some((part) => isToolUIPart(part))
	if (!hasTools && isWaitReply(text)) {
		return (
			<div className="ai-tool done">
				<Hourglass size={14} strokeWidth={2} aria-hidden="true" />
				<span>Waiting for the next sentence</span>
			</div>
		)
	}
	return (
		<>
			{message.parts.map((part, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: streamed parts append in order
				<AssistantPart key={`${message.id}-${index}`} part={part} />
			))}
		</>
	)
}

function UserMessage({ text }: { text: string }) {
	const lecture = [...text.matchAll(/^\[Lecture \| .*? \| segment \d+ \| [^\]]+\] (.*)$/gm)]
	return (
		<p className="ai-message-text">
			{lecture.length > 0 ? lecture.map((match) => match[1]).join(' ') : text}
		</p>
	)
}

function AssistantPart({ part }: { part: UIMessage['parts'][number] }) {
	if (part.type === 'text') {
		return part.text.trim() ? <ChatText text={part.text} /> : null
	}
	if (!isToolUIPart(part)) return null
	const name = getToolName(part)
	const running = part.state === 'input-streaming' || part.state === 'input-available'
	const failed = toolFailed(part)
	const output = part.output as { message?: string; error?: string } | null
	const errorText = part.errorText ?? (failed ? (output?.message ?? output?.error) : undefined)
	return (
		<div className={`ai-tool ${failed ? 'failed' : running ? 'running' : 'done'}`}>
			{failed ? (
				<TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
			) : running ? (
				<LoaderCircle className="ai-tool-spinner" size={14} strokeWidth={2} aria-hidden="true" />
			) : (
				<Check size={14} strokeWidth={2} aria-hidden="true" />
			)}
			<span>{toolLabel(name, part.input)}</span>
			{errorText && <span className="ai-tool-error">{errorText}</span>}
		</div>
	)
}

export function AiPanel({
	open,
	onClose,
	isGestureActive,
	selectedIds,
	onClearSelection,
	initialPrompt,
	onInitialPromptConsumed,
	canvasId,
	onCreateCanvas,
}: AiPanelProps) {
	const [tab, setTab] = useState<AiTab>('chat')
	const [draft, setDraft] = useState('')
	const [listening, setListening] = useState(false)
	const [elapsed, setElapsed] = useState(0)
	const panelRef = useRef<HTMLElement>(null)
	const messagesRef = useRef<HTMLDivElement>(null)
	const composerRef = useRef<HTMLTextAreaElement>(null)
	const pointerInside = useRef(false)
	const wasOpen = useRef(false)
	const lastCanvasId = useRef(canvasId)
	const lectureQueue = useRef<string[]>([])
	const requestLock = useRef(false)
	const requestSeq = useRef(0)
	const releaseRequestRef = useRef<(seq: number) => void>(() => {})
	const [lectureQueued, setLectureQueued] = useState(0)
	const [lessonClipId, setLessonClipId] = useState('')
	const [sessionEnded, setSessionEnded] = useState(false)
	const [summaryDone, setSummaryDone] = useState(false)
	const summarized = useRef(false)
	const selectionRef = useRef(selectedIds)
	selectionRef.current = selectedIds

	const transport = useMemo(() => new DefaultChatTransport({ api: '/api/ai/chat' }), [])
	const { messages, setMessages, sendMessage, status, error, stop, clearError } = useChat({
		transport,
		throttle: 40,
	})

	const busy = status === 'submitted' || status === 'streaming'
	const selection = selectedIds

	const resetLectureQueue = useCallback(() => {
		lectureQueue.current = []
		requestSeq.current++
		requestLock.current = false
		summarized.current = false
		setLectureQueued(0)
		setSessionEnded(false)
		setSummaryDone(false)
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
		const batch: string[] = []
		let size = 0
		while (lectureQueue.current.length > 0 && batch.length < 3) {
			const next = lectureQueue.current[0]
			if (batch.length > 0 && size + next.length > 900) break
			batch.push(lectureQueue.current.shift() as string)
			size += next.length
		}
		if (batch.length === 0) {
			setLectureQueued(0)
			return
		}
		requestLock.current = true
		const seq = ++requestSeq.current
		setLectureQueued(lectureQueue.current.length)
		void sendMessage(
			{ text: batch.join('\n\n') },
			{ body: { selection: selectionRef.current, mode: 'lecture' } },
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
			void sendMessage({ text: value }, { body: { selection, mode: 'chat' } }).finally(() =>
				releaseRequestRef.current(seq),
			)
		},
		[sendMessage, selection, status],
	)

	const submit = (event?: FormEvent) => {
		event?.preventDefault()
		if (busy) return
		send(draft)
	}

	useEffect(() => {
		if (!open || !initialPrompt) return
		const timer = window.setTimeout(() => {
			setDraft(initialPrompt)
			onInitialPromptConsumed()
			send(initialPrompt)
		}, 0)
		return () => window.clearTimeout(timer)
	}, [open, initialPrompt, onInitialPromptConsumed, send])

	const enqueueLecture = useCallback(
		(segment: LessonSegment, clip: LessonClip) => {
			summarized.current = false
			setSummaryDone(false)
			setSessionEnded(false)
			lectureQueue.current.push(
				lectureSegmentText(clip, segment.id, segment.start, segment.end, segment.text),
			)
			setLectureQueued(lectureQueue.current.length)
			pumpLecture()
		},
		[pumpLecture],
	)

	const requestSummary = useCallback(() => {
		if (requestLock.current || summarized.current) return
		requestLock.current = true
		summarized.current = true
		setSummaryDone(true)
		const seq = ++requestSeq.current
		void sendMessage(
			{ text: POST_SESSION_SUMMARY_PROMPT },
			{ body: { selection: selectionRef.current, mode: 'chat' } },
		).finally(() => releaseRequestRef.current(seq))
	}, [sendMessage])

	const endSession = useCallback(() => {
		setSessionEnded(true)
	}, [])

	useEffect(() => {
		if (!sessionEnded || error || busy || summaryDone || messages.length === 0) return
		if (requestLock.current || lectureQueue.current.length > 0) return
		requestSummary()
	}, [sessionEnded, error, busy, summaryDone, messages.length, requestSummary])

	useEffect(() => {
		if (!error) return
		summarized.current = false
		setSummaryDone(false)
	}, [error])

	const resetLecture = useCallback(() => {
		resetLectureQueue()
		if (status === 'submitted' || status === 'streaming') stop()
	}, [resetLectureQueue, status, stop])

	useEffect(() => {
		if (lastCanvasId.current === canvasId) return
		const previous = lastCanvasId.current
		lastCanvasId.current = canvasId
		if (!previous || !canvasId) return
		stop()
		setMessages([])
		clearError()
		setDraft('')
		resetLectureQueue()
	}, [canvasId, stop, setMessages, clearError, resetLectureQueue])

	useEffect(() => {
		if (!open) return
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
			if (event.key !== 'Escape' || isGestureActive()) return
			const focusInside =
				document.activeElement instanceof Node && panelRef.current?.contains(document.activeElement)
			if (!pointerInside.current && !focusInside) return
			event.stopPropagation()
			onClose()
		}
		document.addEventListener('pointerdown', onPointerDown, true)
		document.addEventListener('keydown', onKeyDown, true)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true)
			document.removeEventListener('keydown', onKeyDown, true)
		}
	}, [open, onClose, isGestureActive])

	useEffect(() => {
		if (wasOpen.current && !open) {
			document.querySelector<HTMLButtonElement>('[data-ai-toggle="true"]')?.focus()
		}
		wasOpen.current = open
	}, [open])

	useEffect(() => {
		if (open) return
		setListening(false)
	}, [open])

	useEffect(() => {
		if (tab !== 'audio') setListening(false)
	}, [tab])

	useEffect(() => {
		if (!listening) return
		const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
		return () => window.clearInterval(timer)
	}, [listening])

	// biome-ignore lint/correctness/useExhaustiveDependencies: new messages and a re-shown log must scroll to the end
	useEffect(() => {
		const list = messagesRef.current
		if (!list) return
		list.scrollTop = list.scrollHeight
	}, [messages, status, open, tab])

	useEffect(() => {
		if (!open || tab !== 'chat') return
		const field = composerRef.current
		if (!field) return
		resizeComposer(field)
	}, [open, tab])

	useEffect(() => {
		if (!open) return
		const field = composerRef.current
		if (!field) return
		field.focus()
	}, [open])

	const toggleListening = () => {
		if (listening) {
			setListening(false)
			return
		}
		setElapsed(0)
		setListening(true)
	}

	const focusTab = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
		event.preventDefault()
		const order: AiTab[] = ['chat', 'lesson', 'audio']
		const index = order.indexOf(tab)
		const next =
			event.key === 'Home'
				? 'chat'
				: event.key === 'End'
					? 'audio'
					: order[(index + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length]
		setTab(next)
		document.getElementById(`ai-tab-${next}`)?.focus()
	}

	return (
		<section
			id="ai-panel"
			ref={panelRef}
			className="ai-panel floating-panel"
			aria-label="AI assistant"
			hidden={!open}
		>
			<header className="ai-panel-header">
				<div className="ai-tabs" role="tablist" aria-label="AI modes" onKeyDown={focusTab}>
					<button
						id="ai-tab-chat"
						type="button"
						role="tab"
						className="ai-tab"
						aria-selected={tab === 'chat'}
						aria-controls="ai-panel-chat"
						tabIndex={tab === 'chat' ? 0 : -1}
						onClick={() => setTab('chat')}
					>
						<MessageSquare size={16} strokeWidth={1.75} aria-hidden="true" />
						Chat
					</button>
					<button
						id="ai-tab-lesson"
						type="button"
						role="tab"
						className="ai-tab"
						aria-selected={tab === 'lesson'}
						aria-controls="ai-panel-lesson"
						tabIndex={tab === 'lesson' ? 0 : -1}
						onClick={() => setTab('lesson')}
					>
						<PlayCircle size={16} strokeWidth={1.75} aria-hidden="true" />
						Live
					</button>
					<button
						id="ai-tab-audio"
						type="button"
						role="tab"
						className="ai-tab"
						aria-selected={tab === 'audio'}
						aria-controls="ai-panel-audio"
						tabIndex={tab === 'audio' ? 0 : -1}
						onClick={() => setTab('audio')}
					>
						<AudioLines size={16} strokeWidth={1.75} aria-hidden="true" />
						Audio
					</button>
				</div>
				<IconButton
					icon={X}
					label="Close AI assistant"
					compact
					tooltipSide="bottom"
					onClick={onClose}
				/>
			</header>

			<div
				id="ai-panel-chat"
				className="ai-chat"
				role="tabpanel"
				aria-labelledby="ai-tab-chat"
				hidden={tab !== 'chat'}
			>
				<div
					className="ai-messages"
					role="log"
					aria-live="polite"
					aria-label="Conversation"
					ref={messagesRef}
				>
					{messages.length === 0 && (
						<div className="ai-empty">
							<strong>Draw a lesson with Mico</strong>
							<p>Describe a high-school science topic. Mico sketches it step by step.</p>
							<div className="ai-quick">
								{QUICK_PROMPTS.map(({ label, prompt }) => (
									<button
										key={label}
										type="button"
										className="ai-quick-prompt"
										disabled={busy}
										onClick={() => send(prompt)}
									>
										{label}
									</button>
								))}
							</div>
						</div>
					)}
					{messages.map((message) => (
						<article key={message.id} className={`ai-message ${message.role}`}>
							<span className="ai-message-role">{message.role === 'user' ? 'You' : 'Mico'}</span>
							{message.role === 'user' ? (
								<UserMessage
									text={message.parts
										.filter((part) => part.type === 'text')
										.map((part) => part.text)
										.join('\n')}
								/>
							) : (
								<AssistantMessage message={message} />
							)}
						</article>
					))}
					{status === 'submitted' && (
						<article className="ai-message assistant" aria-label="Mico is thinking">
							<span className="ai-message-role">Mico</span>
							<span className="ai-typing" aria-hidden="true">
								<span />
								<span />
								<span />
							</span>
						</article>
					)}
				</div>

				{error && (
					<div className="ai-error" role="alert">
						<TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
						<div>
							<strong>Assistant request failed</strong>
							<span>{error.message}</span>
							<span>
								Check the Magpie gateway at <code>127.0.0.1:3425</code>.
							</span>
						</div>
						<button
							type="button"
							onClick={() => {
								if (requestLock.current) return
								requestLock.current = true
								const seq = ++requestSeq.current
								clearError()
								void sendMessage(
									{
										text: 'Continue from the current board. Reuse existing objects and do not repeat earlier work.',
									},
									{ body: { selection, mode: 'chat' } },
								).finally(() => releaseRequestRef.current(seq))
							}}
						>
							Continue
						</button>
					</div>
				)}

				<div className="ai-composer-shell">
					{selectedIds.length > 0 && (
						<div className="ai-selection">
							<MousePointer2 size={14} strokeWidth={2} aria-hidden="true" />
							<span>
								{selectedIds.length} selected {selectedIds.length === 1 ? 'object' : 'objects'}{' '}
								attached
							</span>
							<button
								type="button"
								aria-label="Clear selection"
								onClick={onClearSelection}
								className="ai-selection-clear"
							>
								<X size={12} strokeWidth={2.5} aria-hidden="true" />
							</button>
						</div>
					)}
					<form className="ai-composer" onSubmit={submit}>
						<textarea
							ref={composerRef}
							className="ai-composer-input"
							aria-label="Message the assistant"
							placeholder="Describe what to draw…"
							rows={1}
							value={draft}
							onChange={(event) => {
								setDraft(event.target.value)
								resizeComposer(event.currentTarget)
							}}
							onKeyDown={(event) => {
								if (event.key !== 'Enter' || event.shiftKey) return
								if (event.nativeEvent.isComposing) return
								event.preventDefault()
								event.currentTarget.form?.requestSubmit()
							}}
						/>
						{busy ? (
							<IconButton
								icon={Square}
								label="Stop response"
								className="ai-send ai-stop"
								onClick={stop}
							/>
						) : (
							<IconButton
								icon={ArrowUp}
								label="Send message"
								type="submit"
								className="ai-send"
								disabled={!draft.trim()}
							/>
						)}
					</form>
				</div>
			</div>

			<div
				id="ai-panel-lesson"
				className="ai-lesson"
				role="tabpanel"
				aria-labelledby="ai-tab-lesson"
				hidden={tab !== 'lesson'}
			>
				<LessonPanel
					key={canvasId}
					active={open && tab === 'lesson'}
					initialClipId={lessonClipId}
					onClipChange={setLessonClipId}
					aiBusy={busy}
					aiQueued={lectureQueued}
					aiError={Boolean(error)}
					onSegment={enqueueLecture}
					onReset={resetLecture}
					onCreateCanvas={onCreateCanvas}
					onSessionEnd={endSession}
					onSummary={requestSummary}
					canSummarize={!busy && lectureQueued === 0 && messages.length > 0 && !summaryDone}
				/>
			</div>

			<div
				id="ai-panel-audio"
				className="ai-audio"
				role="tabpanel"
				aria-labelledby="ai-tab-audio"
				hidden={tab !== 'audio'}
			>
				<div className="ai-audio-stage">
					<button
						type="button"
						className="ai-mic"
						aria-pressed={listening}
						aria-label={listening ? 'Stop recording' : 'Start recording'}
						onClick={toggleListening}
					>
						<span className="ai-mic-rings" aria-hidden="true" />
						<Mic size={56} strokeWidth={1.5} aria-hidden="true" />
						<span className={`ai-wave ${listening ? 'listening' : ''}`} aria-hidden="true">
							{WAVE_BARS.map((bar) => (
								<span key={bar} style={{ '--bar': bar } as CSSProperties} />
							))}
						</span>
					</button>
				</div>
				<div className="ai-audio-copy">
					<strong>{listening ? 'Listening…' : 'Talk to Mico'}</strong>
					<span className="ai-audio-timer">
						{listening
							? formatDuration(elapsed)
							: 'Tap the microphone to start a voice conversation.'}
					</span>
				</div>
				<p className="ai-audio-note">Voice capture is not connected yet.</p>
			</div>
		</section>
	)
}
