import { useEffect, useRef, useState } from 'react'
import { type MossLiveEvent, MossLiveSession } from '../../stt/mossLive.ts'
import { formatClock } from '../../stt/transcript.ts'
import { drawWave } from '../../waveform.ts'

export type MossPhase = 'idle' | 'connecting' | 'listening' | 'error'

export interface UseMossViewModelProps {
	active: boolean
	canvasId: string
	selectedIds: string[]
}

export function mossCompletedToolActivity(name: string, phase: 'done' | 'error') {
	if (phase === 'error') return `Tool failed: ${name.replaceAll('_', ' ')}`
	return name === 'generate_image'
		? 'Image generation started'
		: name === 'image_generation_status'
			? 'Image generation checked'
			: 'Canvas updated'
}

export function useMossViewModel({ active, canvasId, selectedIds }: UseMossViewModelProps) {
	const sessionRef = useRef<MossLiveSession | null>(null)
	const waveRef = useRef<HTMLCanvasElement>(null)
	const peaks = useRef<number[]>([])
	const pendingTools = useRef(0)
	const [phase, setPhase] = useState<MossPhase>('idle')
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
						pendingTools.current ? 'Drawing…' : mossCompletedToolActivity(event.name, event.phase),
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
	return {
		waveRef,
		phase,
		phaseKind: phase === 'listening' ? 'live' : phase === 'error' ? 'error' : 'ok',
		phaseLabel:
			phase === 'listening'
				? 'Listening…'
				: phase === 'connecting'
					? 'Connecting…'
					: phase === 'error'
						? 'Connection error'
						: 'Ready',
		detail,
		elapsed: formatClock(elapsed),
		transcript,
		activity,
		running,
		hasTranscript,
		hasOutput: running || hasTranscript,
		start,
		stop,
	}
}
