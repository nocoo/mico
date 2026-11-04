import { ArrowUp, AudioLines, MessageSquare, Mic, X } from 'lucide-react'
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { AI_GREETING, type ChatMessage, formatDuration, mockReply, normalizePrompt } from './aiChat'
import { IconButton } from './IconButton'

interface AiPanelProps {
	open: boolean
	onClose: () => void
}

type AiTab = 'chat' | 'audio'

const REPLY_DELAY = 700
const WAVE_BARS = [0, 1, 2, 3, 4, 5, 6]

const greeting: ChatMessage = { id: 'greeting', role: 'assistant', text: AI_GREETING }

function resizeComposer(field: HTMLTextAreaElement) {
	field.style.height = 'auto'
	field.style.height = `${Math.min(field.scrollHeight, 120)}px`
}

export function AiPanel({ open, onClose }: AiPanelProps) {
	const [tab, setTab] = useState<AiTab>('chat')
	const [messages, setMessages] = useState<ChatMessage[]>([greeting])
	const [draft, setDraft] = useState('')
	const [pending, setPending] = useState(false)
	const [listening, setListening] = useState(false)
	const [elapsed, setElapsed] = useState(0)
	const panelRef = useRef<HTMLElement>(null)
	const messagesRef = useRef<HTMLDivElement>(null)
	const composerRef = useRef<HTMLTextAreaElement>(null)
	const replyTimer = useRef<number | undefined>(undefined)
	const wasOpen = useRef(false)
	const pointerInside = useRef(false)

	useEffect(() => () => window.clearTimeout(replyTimer.current), [])

	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			if (!(target instanceof Node)) return
			pointerInside.current = Boolean(
				panelRef.current?.contains(target) ||
					(target instanceof Element && target.closest('[data-ai-toggle="true"]')),
			)
		}
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key !== 'Escape') return
			const active = document.activeElement
			const focusInside = active instanceof Node && panelRef.current?.contains(active)
			if (!focusInside && !pointerInside.current) return
			event.stopPropagation()
			onClose()
		}
		document.addEventListener('pointerdown', onPointerDown, true)
		document.addEventListener('keydown', onKeyDown, true)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true)
			document.removeEventListener('keydown', onKeyDown, true)
		}
	}, [open, onClose])

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
	}, [messages, pending, open, tab])

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

	const send = (event?: FormEvent) => {
		event?.preventDefault()
		const text = normalizePrompt(draft)
		if (!text || pending) return
		setDraft('')
		setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text }])
		setPending(true)
		replyTimer.current = window.setTimeout(() => {
			setMessages((current) => [
				...current,
				{ id: crypto.randomUUID(), role: 'assistant', text: mockReply(text) },
			])
			setPending(false)
		}, REPLY_DELAY)
	}

	const toggleListening = () => {
		if (listening) {
			setListening(false)
			return
		}
		setElapsed(0)
		setListening(true)
	}

	const selectTab = (next: AiTab) => setTab(next)

	const focusTab = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
		event.preventDefault()
		const next =
			event.key === 'Home'
				? 'chat'
				: event.key === 'End'
					? 'audio'
					: tab === 'chat'
						? 'audio'
						: 'chat'
		selectTab(next)
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
						onClick={() => selectTab('chat')}
					>
						<MessageSquare size={16} strokeWidth={1.75} aria-hidden="true" />
						Chat
					</button>
					<button
						id="ai-tab-audio"
						type="button"
						role="tab"
						className="ai-tab"
						aria-selected={tab === 'audio'}
						aria-controls="ai-panel-audio"
						tabIndex={tab === 'audio' ? 0 : -1}
						onClick={() => selectTab('audio')}
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
					{messages.map((message) => (
						<article key={message.id} className={`ai-message ${message.role}`}>
							<span className="ai-message-role">{message.role === 'user' ? 'You' : 'Mico'}</span>
							<p className="ai-message-text">{message.text}</p>
						</article>
					))}
					{pending && (
						<article className="ai-message assistant" aria-label="Mico is replying">
							<span className="ai-message-role">Mico</span>
							<span className="ai-typing" aria-hidden="true">
								<span />
								<span />
								<span />
							</span>
						</article>
					)}
				</div>

				<form className="ai-composer" onSubmit={send}>
					<textarea
						ref={composerRef}
						className="ai-composer-input"
						aria-label="Message the assistant"
						placeholder="Ask Mico anything…"
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
					<IconButton
						icon={ArrowUp}
						label="Send message"
						type="submit"
						className="ai-send"
						disabled={!normalizePrompt(draft) || pending}
					/>
				</form>
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
