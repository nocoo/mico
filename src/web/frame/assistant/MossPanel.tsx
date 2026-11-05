import { Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type MossLiveEvent, MossLiveSession } from '../../stt/mossLive'
import { formatClock } from '../../stt/transcript'
import { drawWave } from '../../waveform'

interface MossPanelProps {
	active: boolean
	canvasId: string
	selectedIds: string[]
}

type Phase = 'idle' | 'connecting' | 'listening' | 'error'

export function MossPanel({ active, canvasId, selectedIds }: MossPanelProps) {
	const sessionRef = useRef<MossLiveSession | null>(null)
	const waveRef = useRef<HTMLCanvasElement>(null)
	const peaks = useRef<number[]>([])
	const pendingTools = useRef(0)
	const [phase, setPhase] = useState<Phase>('idle')
	const [detail, setDetail] = useState('')
	const [elapsed, setElapsed] = useState(0)
	const [transcript, setTranscript] = useState({ user: '', assistant: '' })
	const [activity, setActivity] = useState('Ready to draw')

	const stop = () => {
		const session = sessionRef.current
		sessionRef.current = null
		session?.stop()
		setPhase('idle')
	}

	useEffect(() => {
		if (active) return
		const session = sessionRef.current
		sessionRef.current = null
		session?.stop()
		setPhase('idle')
	}, [active])

	useEffect(
		() => () => {
			const session = sessionRef.current
			sessionRef.current = null
			session?.stop()
		},
		[],
	)

	useEffect(() => {
		if (phase !== 'listening') return
		const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
		return () => window.clearInterval(timer)
	}, [phase])

	useEffect(() => {
		const canvas = waveRef.current
		const parent = canvas?.parentElement
		if (!active || !canvas || !parent) return
		const redraw = () => drawWave(canvas, Float32Array.from(peaks.current), 1, [], 1)
		const observer = new ResizeObserver(redraw)
		observer.observe(parent)
		redraw()
		return () => observer.disconnect()
	}, [active])

	const start = () => {
		if (sessionRef.current) return
		setDetail('')
		setElapsed(0)
		setTranscript({ user: '', assistant: '' })
		setActivity('Ready to draw')
		pendingTools.current = 0
		peaks.current = []
		if (waveRef.current) drawWave(waveRef.current, null, 0, [], 0)
		let session: MossLiveSession
		const onEvent = (event: MossLiveEvent) => {
			if (sessionRef.current !== session) return
			if (event.type === 'status') {
				if (event.phase === 'idle') {
					sessionRef.current = null
					session.stop()
				}
				setPhase(event.phase)
			} else if (event.type === 'error') {
				sessionRef.current = null
				session.stop()
				setDetail(event.message)
				setPhase('error')
			} else if (event.type === 'warning') {
				setDetail(event.message)
			} else if (event.type === 'transcript' && event.text.trim()) {
				setTranscript((current) => ({ ...current, [event.speaker]: event.text }))
			} else if (event.type === 'tool') {
				const name = event.name.replaceAll('_', ' ')
				if (event.phase === 'started') {
					pendingTools.current++
					setActivity(`Drawing: ${name}`)
				} else {
					pendingTools.current = Math.max(0, pendingTools.current - 1)
					setActivity(
						event.phase === 'error'
							? `Tool failed: ${name}`
							: pendingTools.current
								? 'Drawing…'
								: event.name === 'generate_image'
									? 'Image generation started'
									: event.name === 'image_generation_status'
										? 'Image generation checked'
										: 'Canvas updated',
					)
				}
			} else if (event.type === 'audio') {
				peaks.current.push(event.min, event.max)
				if (peaks.current.length > 1200) peaks.current.splice(0, peaks.current.length - 1200)
				if (waveRef.current) drawWave(waveRef.current, Float32Array.from(peaks.current), 1, [], 1)
			}
		}
		session = new MossLiveSession({ canvasId, selection: [...selectedIds], onEvent })
		sessionRef.current = session
		setPhase('connecting')
		void session.start().catch((error: unknown) => {
			if (sessionRef.current !== session) return
			sessionRef.current = null
			session.stop()
			setPhase('error')
			setDetail(error instanceof Error ? error.message : 'Could not start MOSS Live.')
		})
	}

	const running = phase === 'connecting' || phase === 'listening'
	const hasTranscript = Boolean(transcript.user || transcript.assistant)
	return (
		<div className="microphone-panel">
			<div className={`call-stage${running || hasTranscript ? ' has-output' : ''}`}>
				{detail && (
					<p className="call-error" role="alert">
						{detail}
					</p>
				)}
				<div className="call-presence">
					<div className="call-control">
						<button
							type="button"
							className="call-mic"
							aria-pressed={running}
							aria-label={running ? 'Stop recording' : 'Start recording'}
							onClick={running ? stop : start}
						>
							<Mic className="call-mic-icon" size={28} aria-hidden="true" />
							<Square className="call-end-icon" size={28} aria-hidden="true" />
						</button>
					</div>
					<div className="call-meta" aria-live="polite">
						<div className="lesson-status">
							<span
								className="lesson-dot"
								data-kind={phase === 'listening' ? 'live' : phase === 'error' ? 'error' : 'ok'}
							/>
							<span>
								{phase === 'listening'
									? 'Listening…'
									: phase === 'connecting'
										? 'Connecting…'
										: phase === 'error'
											? 'Connection error'
											: 'Ready'}
							</span>
						</div>
						<span className="call-timer">{formatClock(elapsed)}</span>
					</div>
					<span className="call-action-label">
						{running ? 'Tap to end the conversation' : 'Tap the microphone to start'}
					</span>
					<span className="call-ai-status">{activity}</span>
					<span className="call-ai-status">Audio and canvas context are sent to MOSS.</span>
				</div>
				<div className="call-output" aria-hidden={!(running || hasTranscript)}>
					<div className="call-wave-group">
						<canvas
							ref={waveRef}
							className="call-wave"
							height={52}
							role="img"
							aria-label="Microphone waveform"
						/>
					</div>
					<div className="call-caption moss-transcripts" aria-live="polite">
						{transcript.user && (
							<p>
								<strong>You</strong> {transcript.user}
							</p>
						)}
						{transcript.assistant && (
							<p>
								<strong>Mico</strong> {transcript.assistant}
							</p>
						)}
						{!hasTranscript && <p>{running ? 'Listening for speech…' : 'Waiting for speech…'}</p>}
					</div>
				</div>
			</div>
		</div>
	)
}
