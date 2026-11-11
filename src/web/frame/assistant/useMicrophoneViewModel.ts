import { useEffect, useRef, useState } from 'react'
import { TARGET_RATE } from '../../stt/audioSource.ts'
import { MaiClient, type MaiConfig } from '../../stt/maiClient.ts'
import { openMicrophone } from '../../stt/microphone.ts'
import { dedupeHypothesis, formatClock } from '../../stt/transcript.ts'
import { SilenceSegmenter } from '../../stt/vad.ts'
import { drawWave } from '../../waveform.ts'
import type { LessonSegment } from './LessonPanel'
import { appendCompletedTranscript } from './protocol.ts'

export type MicrophonePhase = 'idle' | 'connecting' | 'listening' | 'stopping' | 'done' | 'error'

export interface UseMicrophoneViewModelProps {
	active: boolean
	aiBusy: boolean
	aiQueued: number
	aiError: boolean
	onStart: () => void
	onSegment: (segment: LessonSegment) => void
	onSessionEnd: () => void
	summaryRequesting: boolean
}

interface Recording {
	generation: number
	mic: { stop(): Promise<void> } | null
	client: MaiClient | null
	connected: boolean
	started: boolean
	stopComplete: boolean
	draining: boolean
	segmenter: SilenceSegmenter
	buffer: Int16Array[]
	buffered: number
	peaks: number[]
	sent: number
	committed: number
	pending: { start: number; end: number }[]
	deltas: string[]
	intermediate: string
	segments: number
	stopping: boolean
	timer: number | null
}

function newRecording(): Recording {
	return {
		generation: 0,
		mic: null,
		client: null,
		connected: false,
		started: false,
		stopComplete: false,
		draining: false,
		segmenter: new SilenceSegmenter({ rate: TARGET_RATE }),
		buffer: [],
		buffered: 0,
		peaks: [],
		sent: 0,
		committed: 0,
		pending: [],
		deltas: [],
		intermediate: '',
		segments: 0,
		stopping: false,
		timer: null,
	}
}

function cleanup(rt: Recording) {
	if (rt.mic) void rt.mic.stop().catch(() => {})
	rt.mic = null
	rt.client?.close()
	rt.client = null
	rt.connected = false
	rt.started = false
	if (rt.timer !== null) window.clearTimeout(rt.timer)
	rt.timer = null
	rt.buffer = []
	rt.buffered = 0
}

export function microphoneAiLabel(aiError: boolean, aiBusy: boolean, aiQueued: number) {
	return aiError
		? 'Mico needs attention'
		: aiBusy
			? 'Mico is drawing…'
			: aiQueued > 0
				? `${aiQueued} segments queued`
				: 'Mico is listening'
}

export function microphonePhaseLabel(phase: MicrophonePhase) {
	return phase === 'listening'
		? 'Listening…'
		: phase === 'connecting'
			? 'Connecting…'
			: phase === 'stopping'
				? 'Finishing transcript…'
				: phase === 'done'
					? 'Recording complete'
					: phase === 'error'
						? 'Microphone error'
						: 'Ready'
}

export function useMicrophoneViewModel({
	active,
	aiBusy,
	aiQueued,
	aiError,
	onStart,
	onSegment,
	onSessionEnd,
	summaryRequesting,
}: UseMicrophoneViewModelProps) {
	const runtime = useRef(newRecording())
	const callbacks = useRef({ onStart, onSegment, onSessionEnd })
	callbacks.current = { onStart, onSegment, onSessionEnd }
	const stopRef = useRef<() => void>(() => {})
	const waveRef = useRef<HTMLCanvasElement>(null)
	const [phase, setPhase] = useState<MicrophonePhase>('idle')
	const [detail, setDetail] = useState('')
	const [elapsed, setElapsed] = useState(0)
	const [live, setLive] = useState({ confirmed: '', hypothesis: '' })
	const [segments, setSegments] = useState<LessonSegment[]>([])

	const fail = (rt: Recording, message: string) => {
		rt.generation++
		cleanup(rt)
		setPhase('error')
		setDetail(message)
	}

	const finish = (rt: Recording) => {
		rt.generation++
		cleanup(rt)
		setPhase('done')
		if (rt.segments > 0) callbacks.current.onSessionEnd()
	}

	const commit = (rt: Recording, trailing = 0) => {
		if (!rt.client || rt.sent - rt.committed < TARGET_RATE / 10) return
		const start = rt.committed / TARGET_RATE
		const end = Math.max(start, rt.sent / TARGET_RATE - trailing / 1000)
		rt.pending.push({ start, end })
		rt.committed = rt.sent
		rt.client.commit()
	}

	const send = (rt: Recording, pcm: Int16Array) => {
		if (!rt.client) return
		rt.client.append(pcm, 0, pcm.length)
		let min = 0
		let max = 0
		for (const sample of pcm) {
			min = Math.min(min, sample / 32768)
			max = Math.max(max, sample / 32768)
		}
		rt.peaks.push(min, max)
		if (rt.peaks.length > 1200) rt.peaks.splice(0, rt.peaks.length - 1200)
		if (waveRef.current) drawWave(waveRef.current, Float32Array.from(rt.peaks), 1, [], 1)
		rt.sent += pcm.length
		if (rt.segmenter.push(pcm)) commit(rt, rt.segmenter.lastTrailingMsValue)
		setElapsed(rt.sent / TARGET_RATE)
	}

	const drain = (rt: Recording) => {
		rt.draining = true
		commit(rt)
		if (rt.pending.length === 0) {
			finish(rt)
			return
		}
		rt.timer = window.setTimeout(
			() => fail(rt, 'Timed out waiting for the final transcript.'),
			15_000,
		)
	}

	const stop = () => {
		const rt = runtime.current
		if (rt.stopping || !rt.started) return
		if (!rt.mic) {
			rt.generation++
			cleanup(rt)
			setPhase('idle')
			return
		}
		const mic = rt.mic
		rt.mic = null
		rt.stopping = true
		setPhase('stopping')
		const generation = rt.generation
		void mic
			.stop()
			.then(() => {
				if (runtime.current !== rt || rt.generation !== generation) return
				rt.stopComplete = true
				if (rt.connected) drain(rt)
			})
			.catch((error: unknown) => {
				if (runtime.current === rt && rt.generation === generation) {
					fail(rt, error instanceof Error ? error.message : 'Could not finish microphone audio.')
				}
			})
	}
	stopRef.current = stop

	useEffect(() => {
		if (!active) {
			stopRef.current()
			return
		}
		const canvas = waveRef.current
		if (!canvas?.parentElement) return
		const redraw = () => drawWave(canvas, Float32Array.from(runtime.current.peaks), 1, [], 1)
		const observer = new ResizeObserver(redraw)
		observer.observe(canvas.parentElement)
		redraw()
		return () => observer.disconnect()
	}, [active])

	useEffect(
		() => () => {
			const rt = runtime.current
			rt.generation++
			cleanup(rt)
		},
		[],
	)

	const start = async () => {
		const previous = runtime.current
		cleanup(previous)
		const rt = newRecording()
		rt.generation = previous.generation + 1
		runtime.current = rt
		if (waveRef.current) drawWave(waveRef.current, null, 0, [], 0)
		const generation = rt.generation
		rt.started = true
		const current = () => runtime.current === rt && rt.generation === generation
		setPhase('connecting')
		setDetail('')
		setElapsed(0)
		setSegments([])
		setLive({ confirmed: '', hypothesis: '' })
		callbacks.current.onStart()

		try {
			const mic = await openMicrophone(
				(pcm) => {
					if (!current()) return
					if (rt.connected) {
						send(rt, pcm)
						return
					}
					rt.buffer.push(pcm)
					rt.buffered += pcm.length
					if (rt.buffered > TARGET_RATE * 30) fail(rt, 'Transcription connection took too long.')
				},
				(error) => {
					if (!current()) return
					if (error) {
						fail(rt, error.message)
						return
					}
					setDetail('Microphone disconnected.')
					stopRef.current()
				},
			)
			if (!current()) {
				void mic.stop().catch(() => {})
				return
			}
			rt.mic = mic
			const response = await fetch('/mai/config')
			if (!response.ok) throw new Error('Transcription configuration is unavailable.')
			const config = (await response.json()) as MaiConfig
			if (!current()) return
			if (!config.host || !config.deployment || !config.localPath) {
				throw new Error('Configure Azure MAI transcription in .env before recording.')
			}
			const client = new MaiClient({ path: config.localPath, model: config.deployment })
			rt.client = client
			client.on('error', (event) => {
				if (current())
					fail(rt, typeof event.message === 'string' ? event.message : 'Transcription failed.')
			})
			client.on('closed', () => {
				if (current()) fail(rt, 'Transcription connection closed.')
			})
			const refresh = () =>
				setLive({
					confirmed: rt.deltas.join(''),
					hypothesis: dedupeHypothesis(rt.deltas.join(''), rt.intermediate),
				})
			client.on('delta', (event) => {
				if (!current()) return
				rt.deltas.push(typeof event.delta === 'string' ? event.delta : '')
				refresh()
			})
			client.on('intermediate', (event) => {
				if (!current()) return
				rt.intermediate = typeof event.intermediate === 'string' ? event.intermediate : ''
				refresh()
			})
			client.on('completed', (event) => {
				if (!current()) return
				const pending = rt.pending.shift()
				const text = typeof event.transcript === 'string' ? event.transcript : rt.deltas.join('')
				rt.deltas = []
				rt.intermediate = ''
				refresh()
				if (text.trim()) {
					setLive((current) => ({
						confirmed: appendCompletedTranscript(current.confirmed, text),
						hypothesis: '',
					}))
					const segment = {
						id: ++rt.segments,
						text,
						start: pending?.start ?? 0,
						end: pending?.end ?? rt.sent / TARGET_RATE,
					}
					setSegments((previousSegments) => [...previousSegments, segment])
					callbacks.current.onSegment(segment)
				}
				if (rt.draining && rt.pending.length === 0) finish(rt)
			})
			await client.open()
			if (!current()) return
			rt.connected = true
			const buffered = rt.buffer.splice(0)
			rt.buffered = 0
			for (const chunk of buffered) send(rt, chunk)
			if (rt.stopping) {
				if (rt.stopComplete) drain(rt)
			} else setPhase('listening')
		} catch (error) {
			if (current())
				fail(rt, error instanceof Error ? error.message : 'Could not start microphone.')
		}
	}

	const running = phase === 'connecting' || phase === 'listening'
	const hasOutput = Boolean(running || live.confirmed || live.hypothesis || segments.length > 0)
	return {
		waveRef,
		phase,
		phaseLabel: microphonePhaseLabel(phase),
		phaseKind: phase === 'listening' ? 'live' : phase === 'error' ? 'error' : 'ok',
		detail,
		elapsed: formatClock(elapsed),
		live,
		running,
		hasOutput,
		disabled: phase === 'stopping' || summaryRequesting,
		aiLabel: microphoneAiLabel(aiError, aiBusy, aiQueued),
		toggleRecording: running ? stop : () => void start(),
	}
}
