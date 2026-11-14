import { SegmentedControl } from '@radix-ui/themes'
import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import {
	ArrowUp,
	AudioLines,
	Check,
	Hourglass,
	LoaderCircle,
	MessageSquare,
	Mic,
	MousePointer2,
	PenTool,
	Plus,
	Settings,
	Square,
	TriangleAlert,
	X,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { IconButton } from '../../IconButton'
import { isWaitReply } from '../../stt/transcript'
import type { AssistantActions, AssistantState } from '../contracts'
import { AiSettings } from './AiSettings'
import { LessonPanel, type LessonSegment } from './LessonPanel'
import { MicrophonePanel } from './MicrophonePanel'
import { MossPanel } from './MossPanel'
import type { AssistantViewModel } from './useAssistantSession'
import type { MossAssistantStatus } from './useMossViewModel'

interface AssistantViewProps {
	state: AssistantState
	actions: AssistantActions
	model: AssistantViewModel
	mossActivity: AssistantViewModel['activity']
	onMossStatusChange: (status: MossAssistantStatus | null) => void
}

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
	add_images: 'Placing images',
	generate_image: 'Starting image generation',
	image_generation_status: 'Checking image generation',
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
	add_images: 'images',
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

export function AssistantView({
	state,
	actions,
	model,
	mossActivity,
	onMossStatusChange,
}: AssistantViewProps) {
	const submit = (event?: FormEvent) => model.submit(event)

	return (
		<div className="ai-assistant">
			<header className="topbar ai-topbar">
				<div className="ai-trigger floating-panel" data-open={String(state.open)}>
					<button
						type="button"
						className="ai-trigger-button"
						aria-label={state.open ? 'Close AI assistant' : 'Open AI assistant'}
						aria-pressed={state.open}
						aria-expanded={state.open}
						aria-controls="ai-panel"
						onClick={actions.toggle}
						data-ai-toggle="true"
					>
						<PenTool className="trigger-logo" aria-hidden="true" />
						<X className="trigger-close" aria-hidden="true" />
					</button>
					<span
						className={`status ${model.connection.status}`}
						role="status"
						aria-label={model.connection.label}
						title={model.connection.title}
					>
						<span className="status-dot" aria-hidden="true" />
					</span>
				</div>
			</header>

			<div
				className="ai-status-pill floating-panel"
				data-state={mossActivity.state}
				role="status"
				aria-live="polite"
			>
				<span className="ai-status-orb" aria-hidden="true" />
				<span className="ai-status-text">{mossActivity.text}</span>
			</div>

			<section
				id="ai-panel"
				ref={model.panelRef}
				className={`ai-panel floating-panel${state.open ? ' is-open' : ''}`}
				data-tab={model.tab}
				aria-label="AI assistant"
				aria-hidden={!state.open}
				inert={!state.open}
			>
				<header className="ai-panel-header">
					<div className="ai-tabs" role="tablist" aria-label="AI modes" onKeyDown={model.focusTab}>
						{(
							[
								{ id: 'chat', label: 'Chat', icon: MessageSquare },
								{ id: 'audio', label: 'Audio', icon: AudioLines },
								{ id: 'live', label: 'Live', icon: Mic },
								{ id: 'settings', label: 'Settings', icon: Settings },
							] as const
						).map(({ id, label, icon }) => (
							<IconButton
								key={id}
								id={`ai-tab-${id}`}
								icon={icon}
								label={label}
								role="tab"
								className="ai-tab"
								aria-selected={model.tab === id}
								aria-controls={`ai-panel-${id}`}
								tabIndex={model.tab === id ? 0 : -1}
								compact
								tooltipSide="bottom"
								onClick={() => model.setTab(id)}
							>
								<span>{label}</span>
							</IconButton>
						))}
					</div>
					<span className="ai-close-slot" aria-hidden="true" />
				</header>

				<div
					id="ai-panel-chat"
					className="ai-chat"
					role="tabpanel"
					aria-labelledby="ai-tab-chat"
					hidden={model.tab !== 'chat'}
				>
					<div
						className="ai-messages"
						role="log"
						aria-live="polite"
						aria-label="Conversation"
						ref={model.messagesRef}
					>
						{model.messages.length === 0 && (
							<div className="ai-empty">
								<strong>Draw a lesson with Mico</strong>
								<p>Describe a high-school science topic. Mico sketches it step by step.</p>
								<span className="ai-quick-label">Try a topic</span>
								<div className="ai-quick">
									{QUICK_PROMPTS.map(({ label, prompt }) => (
										<button
											key={label}
											type="button"
											className="ai-quick-prompt"
											disabled={model.busy}
											onClick={() => model.send(prompt)}
										>
											{label}
										</button>
									))}
								</div>
							</div>
						)}
						{model.messages.map((message) => (
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
						{model.status === 'submitted' && (
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

					{model.error && (
						<div className="ai-error" role="alert">
							<TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
							<div>
								<strong>Assistant request failed</strong>
								<span>{model.error.message}</span>
								<span>Check your endpoint and model in Settings.</span>
							</div>
							<button type="button" onClick={model.continueChat}>
								Continue
							</button>
						</div>
					)}

					<div className="ai-chat-actions">
						<button
							type="button"
							className="ai-summary-button"
							onClick={() => actions.createCanvas('New canvas')}
						>
							<Plus size={15} aria-hidden="true" />
							New canvas
						</button>
						{model.sessionEnded && model.messages.length > 0 && (
							<button
								type="button"
								className="ai-summary-button"
								disabled={
									model.busy ||
									model.lectureQueued > 0 ||
									model.summaryDone ||
									model.summaryRequesting
								}
								onClick={model.requestSummary}
							>
								Create session summary
							</button>
						)}
					</div>
					<div className="ai-composer-shell">
						{state.selectedIds.length > 0 && (
							<div className="ai-selection">
								<MousePointer2 size={14} strokeWidth={2} aria-hidden="true" />
								<span>
									{state.selectedIds.length} selected{' '}
									{state.selectedIds.length === 1 ? 'object' : 'objects'} attached
								</span>
								<button
									type="button"
									aria-label="Clear selection"
									onClick={actions.clearSelection}
									className="ai-selection-clear"
								>
									<X size={12} strokeWidth={2.5} aria-hidden="true" />
								</button>
							</div>
						)}
						<form className="ai-composer" onSubmit={submit}>
							<textarea
								ref={model.composerRef}
								className="ai-composer-input"
								aria-label="Message the assistant"
								placeholder="Describe what to draw…"
								rows={1}
								value={model.draft}
								onChange={(event) => {
									model.setDraft(event.target.value)
									resizeComposer(event.currentTarget)
								}}
								onKeyDown={(event) => {
									if (event.key !== 'Enter' || event.shiftKey) return
									if (event.nativeEvent.isComposing) return
									event.preventDefault()
									event.currentTarget.form?.requestSubmit()
								}}
							/>
							{model.busy ? (
								<IconButton
									icon={Square}
									label="Stop response"
									className="ai-send ai-stop"
									onClick={model.stop}
								/>
							) : (
								<IconButton
									icon={ArrowUp}
									label="Send message"
									type="submit"
									className="ai-send"
									disabled={!model.draft.trim()}
								/>
							)}
						</form>
					</div>
				</div>

				<div
					id="ai-panel-audio"
					className="ai-audio-recordings"
					role="tabpanel"
					aria-labelledby="ai-tab-audio"
					hidden={model.tab !== 'audio'}
				>
					<LessonPanel
						key={state.canvasId}
						active={state.open && model.tab === 'audio'}
						suspend={state.open && model.tab === 'live'}
						initialClipId={model.lessonClipId}
						onClipChange={model.setLessonClipId}
						aiBusy={model.busy}
						aiQueued={model.lectureQueued}
						aiError={Boolean(model.error)}
						onSegment={model.enqueueLecture}
						onReset={model.resetLecture}
						onCreateCanvas={actions.createCanvas}
						onSessionEnd={model.endSession}
						onSummary={model.requestSummary}
						canSummarize={
							model.sessionEnded &&
							!model.busy &&
							model.lectureQueued === 0 &&
							model.messages.length > 0 &&
							!model.summaryDone &&
							!model.summaryRequesting
						}
					/>
				</div>

				<div
					id="ai-panel-live"
					className="ai-live"
					role="tabpanel"
					aria-labelledby="ai-tab-live"
					hidden={model.tab !== 'live'}
				>
					<SegmentedControl.Root
						className="live-provider"
						aria-label="Live provider"
						size="1"
						value={model.liveProvider}
						onValueChange={model.selectLiveProvider}
					>
						<SegmentedControl.Item
							value="moss"
							aria-disabled={!state.mossEnabled}
							data-moss-disabled={String(!state.mossEnabled)}
							tabIndex={state.mossEnabled ? undefined : -1}
							onPointerDown={(event) => {
								if (!state.mossEnabled) event.preventDefault()
							}}
							onClick={(event) => {
								if (!state.mossEnabled) event.preventDefault()
							}}
							onKeyDown={(event) => {
								if (!state.mossEnabled) event.preventDefault()
							}}
						>
							MOSS Live
						</SegmentedControl.Item>
						<SegmentedControl.Item value="mai">MAI Transcribe</SegmentedControl.Item>
					</SegmentedControl.Root>
					{state.mossEnabled && model.liveProvider === 'moss' ? (
						<MossPanel
							key={state.canvasId}
							active={state.open && model.tab === 'live'}
							canvasId={state.canvasId}
							selectedIds={state.selectedIds}
							onStatusChange={onMossStatusChange}
						/>
					) : (
						<MicrophonePanel
							key={state.canvasId}
							active={state.open && model.tab === 'live'}
							aiBusy={model.busy}
							aiQueued={model.lectureQueued}
							aiError={Boolean(model.error)}
							onStart={model.startMicrophone}
							onSegment={(segment: LessonSegment) =>
								model.enqueueLecture(segment, { subject: 'Live speech', title: 'Microphone' })
							}
							onSessionEnd={model.endSession}
							summaryRequesting={model.summaryRequesting}
						/>
					)}
				</div>

				<div
					id="ai-panel-settings"
					className="ai-settings-panel"
					role="tabpanel"
					aria-labelledby="ai-tab-settings"
					hidden={model.tab !== 'settings'}
				>
					<AiSettings active={state.open && model.tab === 'settings'} />
				</div>
			</section>
		</div>
	)
}
