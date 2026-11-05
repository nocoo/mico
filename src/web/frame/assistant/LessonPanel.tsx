import { FileText, LoaderCircle, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SelectField } from '../../SelectField'
import { type LectureAudio, loadLecture, Player, TARGET_RATE } from '../../stt/audioSource'
import {
	MaiClient,
	type MaiConfig,
	maiEmptyAudioBufferError,
	maiErrorMessage,
	maiEventRequestId,
} from '../../stt/maiClient'
import { dedupeHypothesis, formatClock, type LessonClip } from '../../stt/transcript'
import { SilenceSegmenter } from '../../stt/vad'
import { drawWave } from '../../waveform.ts'

export interface LessonSegment {
	id: number
	text: string
	start: number
	end: number
}

interface LessonPanelProps {
	active: boolean
	suspend: boolean
	initialClipId?: string
	onClipChange?: (id: string) => void
	aiBusy: boolean
	aiQueued: number
	aiError?: boolean
	onSegment: (segment: LessonSegment, clip: LessonClip) => void
	onReset: () => void
	onCreateCanvas: (name: string) => void
	onSessionEnd: () => void
	onSummary: () => void
	canSummarize: boolean
}

type Phase =
	| 'idle'
	| 'loading'
	| 'connecting'
	| 'ready'
	| 'streaming'
	| 'paused'
	| 'stopping'
	| 'done'
	| 'closed'
	| 'error'

interface Runtime {
	ctx: AudioContext | null
	lecture: LectureAudio | null
	loadedId: string | null
	player: Player | null
	client: MaiClient | null
	segmenter: SilenceSegmenter
	sentSamples: number
	sentAtLastCommit: number
	pendingCommits: { at: number; start: number; end: number; eventId: string }[]
	deltas: string[]
	intermediate: string
	frames: number
	partials: number
	commits: number
	latencies: number[]
	closing: boolean
	stopping: boolean
	starting: boolean
	generation: number
	timer: number | null
	nextSegmentId: number
}

const PHASE_LABEL: Record<Phase, string> = {
	idle: 'Ready',
	loading: 'Loading recording…',
	connecting: 'Connecting…',
	ready: 'Session ready',
	streaming: 'Live transcription',
	paused: 'Paused',
	stopping: 'Finishing transcript…',
	done: 'Recording complete',
	closed: 'Disconnected',
	error: 'Error',
}

const PHASE_KIND: Record<Phase, string> = {
	idle: 'idle',
	loading: 'busy',
	connecting: 'busy',
	ready: 'ok',
	streaming: 'live',
	paused: 'warn',
	stopping: 'busy',
	done: 'ok',
	closed: 'idle',
	error: 'error',
}

function newRuntime(): Runtime {
	const segmenter = new SilenceSegmenter({ rate: TARGET_RATE })
	segmenter.setSilenceMs(1000)
	return {
		ctx: null,
		lecture: null,
		loadedId: null,
		player: null,
		client: null,
		segmenter,
		sentSamples: 0,
		sentAtLastCommit: 0,
		pendingCommits: [],
		deltas: [],
		intermediate: '',
		frames: 0,
		partials: 0,
		commits: 0,
		latencies: [],
		closing: false,
		stopping: false,
		starting: false,
		generation: 0,
		timer: null,
		nextSegmentId: 1,
	}
}

export function LessonPanel({
	active,
	suspend,
	initialClipId,
	onClipChange,
	aiBusy,
	aiQueued,
	aiError,
	onSegment,
	onReset,
	onCreateCanvas,
	onSessionEnd,
	onSummary,
	canSummarize,
}: LessonPanelProps) {
	const runtime = useRef<Runtime>(newRuntime())
	const onSegmentRef = useRef(onSegment)
	const onResetRef = useRef(onReset)
	const onSessionEndRef = useRef(onSessionEnd)
	onSegmentRef.current = onSegment
	onResetRef.current = onReset
	onSessionEndRef.current = onSessionEnd

	const [clips, setClips] = useState<LessonClip[]>([])
	const [config, setConfig] = useState<MaiConfig | null>(null)
	const [selectedId, setSelectedId] = useState(initialClipId ?? '')
	const [phase, setPhase] = useState<Phase>('idle')
	const [detail, setDetail] = useState('')
	const [live, setLive] = useState({ confirmed: '', hypothesis: '' })
	const [segments, setSegments] = useState<LessonSegment[]>([])
	const [stats, setStats] = useState({ played: 0, sent: 0, latency: null as number | null })
	const [vad, setVad] = useState({ db: -90, speaking: false })
	const [progress, setProgress] = useState(0)
	const [peaks, setPeaks] = useState<Float32Array | null>(null)
	const [silenceMs, setSilenceMs] = useState(1000)
	const [rate, setRate] = useState(1)
	const waveRef = useRef<HTMLCanvasElement>(null)
	const endedNotified = useRef(false)

	const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0]
	const duration = selected?.duration ?? 0

	useEffect(() => {
		let cancelled = false
		void Promise.all([
			fetch('/mai/config').then((response) => response.json() as Promise<MaiConfig>),
			fetch('/evals/manifest.json').then(
				(response) => response.json() as Promise<{ evals: LessonClip[] }>,
			),
		])
			.then(([nextConfig, manifest]) => {
				if (cancelled) return
				setConfig(nextConfig)
				setClips(manifest.evals)
				setSelectedId((current) =>
					manifest.evals.some((clip) => clip.id === current)
						? current
						: manifest.evals[0]?.id || '',
				)
			})
			.catch((error: Error) => {
				if (!cancelled) {
					setPhase('error')
					setDetail(`Lesson data unavailable: ${error.message}`)
				}
			})
		return () => {
			cancelled = true
		}
	}, [])

	useEffect(() => {
		if (!suspend) return
		const rt = runtime.current
		if (rt.starting) {
			rt.generation++
			rt.starting = false
			rt.client?.close()
			rt.client = null
			setPhase('paused')
		}
		if (rt.player?.playing) {
			rt.player.pause()
			if (rt.timer !== null) window.clearTimeout(rt.timer)
			rt.timer = null
			setPhase('paused')
			setVad({ db: -90, speaking: false })
		}
	}, [suspend])

	const waveDataRef = useRef({ peaks, progress, segments, duration })
	waveDataRef.current = { peaks, progress, segments, duration }

	useEffect(() => {
		if (!active || !waveRef.current) return
		drawWave(waveRef.current, peaks, progress, segments, duration)
	}, [active, peaks, progress, segments, duration])

	useEffect(() => {
		const canvas = waveRef.current
		const observedElement = canvas?.parentElement
		if (!active || !canvas || !observedElement) return
		const redraw = () => {
			const data = waveDataRef.current
			drawWave(canvas, data.peaks, data.progress, data.segments, data.duration)
		}
		const observer = new ResizeObserver(redraw)
		observer.observe(observedElement)
		redraw()
		return () => observer.disconnect()
	}, [active])

	useEffect(() => {
		const rt = runtime.current
		return () => {
			if (rt.timer !== null) window.clearInterval(rt.timer)
			rt.timer = null
			rt.closing = true
			rt.generation++
			rt.starting = false
			rt.client?.close()
			rt.client = null
			rt.player?.pause()
			void rt.ctx?.close()
		}
	}, [])

	const refreshLive = () => {
		const rt = runtime.current
		setLive({
			confirmed: rt.deltas.join(''),
			hypothesis: dedupeHypothesis(rt.deltas.join(''), rt.intermediate),
		})
	}

	const refreshStats = () => {
		const rt = runtime.current
		setStats({
			played: rt.player?.position ?? 0,
			sent: rt.sentSamples / TARGET_RATE,
			latency: rt.latencies.length
				? rt.latencies.reduce((sum, value) => sum + value, 0) / rt.latencies.length
				: null,
		})
	}

	const resetSession = () => {
		const rt = runtime.current
		if (rt.timer !== null) window.clearInterval(rt.timer)
		rt.timer = null
		rt.closing = true
		rt.client?.close()
		rt.client = null
		rt.player?.reset()
		rt.sentSamples = 0
		rt.sentAtLastCommit = 0
		rt.pendingCommits = []
		rt.deltas = []
		rt.intermediate = ''
		rt.frames = 0
		rt.partials = 0
		rt.commits = 0
		rt.latencies = []
		rt.stopping = false
		rt.starting = false
		rt.generation++
		rt.nextSegmentId = 1
		endedNotified.current = false
		rt.segmenter.reset()
		setLive({ confirmed: '', hypothesis: '' })
		setSegments([])
		setStats({ played: 0, sent: 0, latency: null })
		setVad({ db: -90, speaking: false })
		setProgress(0)
		onResetRef.current()
	}

	const ensureSetup = async (clip: LessonClip, generation: number): Promise<boolean> => {
		const rt = runtime.current
		if (rt.generation !== generation) return false
		if (!rt.ctx) rt.ctx = new AudioContext()
		if (rt.ctx.state === 'suspended') await rt.ctx.resume()
		if (rt.loadedId === clip.id && rt.lecture) return true
		if (rt.generation !== generation) return false
		setPhase('loading')
		setDetail('')
		const lecture = await loadLecture(rt.ctx, `/evals/${clip.audio}`)
		if (rt.generation !== generation) return false
		rt.lecture = lecture
		rt.loadedId = clip.id
		rt.player = new Player(rt.ctx, lecture)
		setPeaks(new Float32Array(lecture.peaks))
		setPhase('idle')
		return true
	}

	const finish = () => {
		const rt = runtime.current
		rt.closing = true
		rt.client?.close()
		rt.client = null
		if (rt.timer !== null) window.clearInterval(rt.timer)
		rt.timer = null
		setPhase('done')
		setVad({ db: -90, speaking: false })
		if (!endedNotified.current) {
			endedNotified.current = true
			onSessionEndRef.current()
		}
	}

	const failSession = (message: string) => {
		const rt = runtime.current
		rt.closing = true
		rt.player?.pause()
		if (rt.timer !== null) window.clearTimeout(rt.timer)
		rt.timer = null
		rt.pendingCommits = []
		rt.stopping = false
		rt.starting = false
		rt.client?.close()
		rt.client = null
		setPhase('error')
		setDetail(message)
		setVad({ db: -90, speaking: false })
	}

	const connect = async (clip: LessonClip, generation: number) => {
		if (!config) throw new Error('MAI transcription config is missing')
		const rt = runtime.current
		const client = new MaiClient({
			path: config.localPath,
			model: config.deployment,
			language: clip.lang === 'zh' ? 'zh' : clip.lang === 'ja' ? 'ja' : 'en',
		})
		rt.client = client
		rt.closing = false
		const current = () => rt.client === client && rt.generation === generation

		client.on('error', (event) => {
			if (!current()) return
			if (rt.stopping && maiEmptyAudioBufferError(event)) {
				const eventId = maiEventRequestId(event)
				const pendingIndex = eventId
					? rt.pendingCommits.findIndex((pending) => pending.eventId === eventId)
					: -1
				if (eventId && pendingIndex >= 0) {
					rt.pendingCommits.splice(pendingIndex, 1)
					if (rt.pendingCommits.length === 0) finish()
					return
				}
			}
			failSession(maiErrorMessage(event))
		})
		client.on('closed', (event) => {
			if (!current()) return
			if (rt.closing) {
				rt.client = null
				return
			}
			rt.client = null
			failSession(`Connection closed ${String(event.code ?? '')}`)
		})
		client.on('delta', (event) => {
			if (!current()) return
			rt.deltas.push(typeof event.delta === 'string' ? event.delta : '')
			refreshLive()
		})
		client.on('intermediate', (event) => {
			if (!current()) return
			rt.intermediate = typeof event.intermediate === 'string' ? event.intermediate : ''
			rt.partials++
			refreshLive()
		})
		client.on('completed', (event) => {
			if (!current()) return
			const eventId = maiEventRequestId(event)
			const pendingIndex = eventId
				? rt.pendingCommits.findIndex((pending) => pending.eventId === eventId)
				: rt.pendingCommits.length
					? 0
					: -1
			const pending = pendingIndex >= 0 ? rt.pendingCommits.splice(pendingIndex, 1)[0] : undefined
			if (pending) rt.latencies.push(performance.now() - pending.at)
			const text = typeof event.transcript === 'string' ? event.transcript : rt.deltas.join('')
			const segment: LessonSegment = {
				id: rt.nextSegmentId++,
				text,
				start: pending?.start ?? 0,
				end: pending?.end ?? rt.sentSamples / TARGET_RATE,
			}
			rt.deltas = []
			rt.intermediate = ''
			refreshLive()
			if (text.trim()) {
				setSegments((current) => [...current, segment])
				onSegmentRef.current(segment, clip)
			}
			refreshStats()
			if (rt.stopping && rt.pendingCommits.length === 0) finish()
		})

		setPhase('connecting')
		await client.open()
		if (!current()) {
			client.close()
			return
		}
		setPhase('ready')
	}

	const commit = (force = false) => {
		const rt = runtime.current
		const unsent = rt.sentSamples - rt.sentAtLastCommit
		if (!rt.client || unsent <= 0) return
		if (!force && unsent < TARGET_RATE / 10) return
		if (force && unsent < TARGET_RATE / 10) {
			const padding = new Int16Array(TARGET_RATE / 10 - unsent)
			rt.client.append(padding, 0, padding.length)
		}
		rt.commits++
		const eventId = `commit-${rt.generation}-${rt.commits}`
		const start = rt.sentAtLastCommit / TARGET_RATE
		const end = Math.max(
			start,
			rt.sentSamples / TARGET_RATE - rt.segmenter.lastTrailingMsValue / 1000,
		)
		rt.pendingCommits.push({ at: performance.now(), start, end, eventId })
		rt.sentAtLastCommit = rt.sentSamples
		rt.client.commit(eventId)
		refreshStats()
	}

	const sendUpTo = (seconds: number) => {
		const rt = runtime.current
		if (!rt.lecture || !rt.client) return
		const target =
			seconds >= rt.lecture.duration
				? rt.lecture.pcm.length
				: Math.min(rt.lecture.pcm.length, Math.ceil(seconds * TARGET_RATE))
		if (target <= rt.sentSamples) return
		const maxChunk = TARGET_RATE / 5
		while (rt.sentSamples < target) {
			const from = rt.sentSamples
			const end = Math.min(target, from + maxChunk)
			rt.client.append(rt.lecture.pcm, from, end)
			rt.sentSamples = end
			rt.frames++
			if (rt.segmenter.push(rt.lecture.pcm.subarray(from, end))) commit()
		}
	}

	const endOfAudio = () => {
		const rt = runtime.current
		rt.player?.pause()
		rt.player?.seekTo(rt.player.duration)
		if (rt.timer !== null) window.clearInterval(rt.timer)
		rt.timer = null
		if (rt.lecture) sendUpTo(rt.lecture.duration)
		rt.segmenter.flush()
		if (rt.segmenter.hasSpeech) commit(true)
		if (rt.pendingCommits.length === 0) finish()
		else {
			rt.stopping = true
			setPhase('stopping')
		}
	}

	const loop = () => {
		const rt = runtime.current
		if (!rt.player?.playing) return
		const position = rt.player.position
		sendUpTo(position)
		setStats({
			played: position,
			sent: rt.sentSamples / TARGET_RATE,
			latency: rt.latencies.length
				? rt.latencies.reduce((sum, value) => sum + value, 0) / rt.latencies.length
				: null,
		})
		setVad({ db: rt.segmenter.peakDb, speaking: rt.segmenter.speaking })
		setProgress(position)
		if (position >= (rt.lecture?.duration ?? 0)) {
			endOfAudio()
			return
		}
		rt.timer = window.setTimeout(loop, 100)
	}

	const start = async (clip: LessonClip) => {
		const rt = runtime.current
		if (rt.starting) return
		rt.starting = true
		const generation = rt.generation
		try {
			let ready: boolean
			try {
				ready = await ensureSetup(clip, generation)
			} catch (error) {
				if (rt.generation === generation) {
					failSession(`Audio load failed: ${(error as Error).message}`)
				}
				return
			}
			if (!ready || rt.generation !== generation) return
			if (!rt.client) {
				try {
					await connect(clip, generation)
				} catch (error) {
					if (rt.generation === generation) {
						failSession(`Transcription connection failed: ${(error as Error).message}`)
					}
					return
				}
			}
			if (!rt.player || rt.generation !== generation) return
			rt.player.play(rate)
			setPhase('streaming')
			setVad({ db: rt.segmenter.db, speaking: false })
			if (rt.timer !== null) window.clearTimeout(rt.timer)
			rt.timer = window.setTimeout(loop, 100)
		} finally {
			if (rt.generation === generation) rt.starting = false
		}
	}

	const pause = () => {
		const rt = runtime.current
		rt.player?.pause()
		if (rt.timer !== null) window.clearTimeout(rt.timer)
		rt.timer = null
		setPhase('paused')
		setVad({ db: -90, speaking: false })
	}

	const resetAndStart = async () => {
		resetSession()
		if (selected) await start(selected)
	}

	const toggle = () => {
		const rt = runtime.current
		if (['done', 'error', 'closed'].includes(phase)) {
			void resetAndStart()
			return
		}
		if (rt.player?.playing) {
			pause()
			return
		}
		if (selected) void start(selected)
	}

	const selectClip = (id: string) => {
		const rt = runtime.current
		rt.player?.pause()
		if (rt.timer !== null) window.clearInterval(rt.timer)
		rt.timer = null
		resetSession()
		rt.loadedId = null
		rt.lecture = null
		rt.player = null
		setPeaks(null)
		setSelectedId(id)
		onClipChange?.(id)
		setPhase('idle')
	}

	const changeRate = (next: number) => {
		const rt = runtime.current
		setRate(next)
		if (!rt.player?.playing) return
		const position = rt.player.position
		rt.player.pause()
		rt.player.seekTo(position)
		rt.player.play(next)
	}

	const changeSilence = (ms: number) => {
		setSilenceMs(ms)
		runtime.current.segmenter.setSilenceMs(ms)
	}

	const createCanvas = () => {
		const rt = runtime.current
		rt.player?.pause()
		if (rt.timer !== null) window.clearTimeout(rt.timer)
		rt.timer = null
		resetSession()
		onCreateCanvas(selected?.title ?? 'Recording')
	}

	const playing = runtime.current.player?.playing === true
	const totalSegments = segments.length
	const aiLabel = aiError
		? 'Mico needs attention'
		: aiBusy
			? 'Mico is drawing…'
			: aiQueued > 0
				? `${aiQueued} segment${aiQueued === 1 ? '' : 's'} queued`
				: 'Mico is listening'

	return (
		<div className="lesson">
			<div className="lesson-clip">
				<span className="select-label">Recording</span>
				<SelectField
					label="Recording"
					value={selected?.id ?? ''}
					options={clips.map((clip) => ({
						value: clip.id,
						label: `${clip.lang === 'zh' ? '中文' : clip.lang === 'ja' ? '日本語' : 'EN'} · ${clip.subject} · ${clip.title}`,
					}))}
					onChange={selectClip}
					disabled={clips.length === 0}
				/>
				<div className="lesson-meta">
					<span>
						{selected ? `${selected.subject} · ${selected.voice}` : 'Loading recordings…'}
					</span>
					<span>{formatClock(duration)}</span>
				</div>
			</div>

			<div className="lesson-status" data-kind={PHASE_KIND[phase]}>
				<span className="lesson-dot" data-kind={PHASE_KIND[phase]} aria-hidden="true" />
				<span>{detail || PHASE_LABEL[phase]}</span>
				<span className="lesson-ai">
					<span
						className="lesson-ai-dot"
						data-busy={aiBusy ? 'true' : 'false'}
						aria-hidden="true"
					/>
					{aiLabel}
				</span>
			</div>

			<canvas ref={waveRef} className="lesson-wave" height={52} />
			<div className="lesson-times">
				<span>{formatClock(progress)}</span>
				<span>{formatClock(duration)}</span>
			</div>

			<div className="lesson-live" aria-live="polite">
				<span className="lesson-live-label">Live transcript</span>
				<p>
					{!live.confirmed && !live.hypothesis && (
						<span className="lesson-live-empty">Waiting for speech…</span>
					)}
					<span className="lesson-confirmed">{live.confirmed}</span>
					<span className="lesson-hypothesis">{live.hypothesis}</span>
					<span className="lesson-caret" aria-hidden="true" />
				</p>
			</div>

			<div className="lesson-controls">
				<button type="button" className="lesson-primary" onClick={toggle}>
					{playing ? (
						<Pause size={16} strokeWidth={2} aria-hidden="true" />
					) : (
						<Play size={16} strokeWidth={2} aria-hidden="true" />
					)}
					{playing ? 'Pause' : phase === 'streaming' ? 'Resume' : 'Play recording'}
				</button>
				<button type="button" className="lesson-button" onClick={() => void resetAndStart()}>
					<RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
					Restart
				</button>
				<button type="button" className="lesson-button" onClick={createCanvas}>
					<Plus size={15} strokeWidth={2} aria-hidden="true" />
					New canvas
				</button>
			</div>

			<div className="lesson-summary-row">
				<button
					type="button"
					className="lesson-summary"
					disabled={!canSummarize}
					onClick={onSummary}
				>
					<FileText size={15} strokeWidth={2} aria-hidden="true" />
					Create session summary
				</button>
			</div>

			<div className="lesson-metrics">
				<div>
					<span className="lesson-metric-label">Played</span>
					<b>{stats.played.toFixed(1)}s</b>
				</div>
				<div>
					<span className="lesson-metric-label">Sent</span>
					<b>{stats.sent.toFixed(1)}s</b>
				</div>
				<div>
					<span className="lesson-metric-label">Segments</span>
					<b>{totalSegments}</b>
				</div>
				<div>
					<span className="lesson-metric-label">Latency</span>
					<b>{stats.latency == null ? '—' : `${stats.latency.toFixed(0)}ms`}</b>
				</div>
			</div>

			<div className="lesson-sliders">
				<label>
					<span>
						Silence cut <b>{silenceMs}ms</b>
					</span>
					<input
						type="range"
						min={250}
						max={1000}
						step={50}
						value={silenceMs}
						onChange={(event) => changeSilence(Number(event.target.value))}
					/>
				</label>
				<label>
					<span>
						Speed <b>{rate.toFixed(2).replace(/0$/, '')}×</b>
					</span>
					<input
						type="range"
						min={0.75}
						max={2}
						step={0.25}
						value={rate}
						onChange={(event) => changeRate(Number(event.target.value))}
					/>
				</label>
			</div>

			<div className="lesson-vad">
				<span>Energy</span>
				<div className="lesson-meter">
					<i
						data-speaking={vad.speaking ? 'true' : 'false'}
						style={{ width: `${Math.max(0, Math.min(100, ((vad.db + 60) / 54) * 100))}%` }}
					/>
				</div>
				<span className="lesson-vad-label">
					{phase === 'streaming'
						? vad.speaking
							? `speech · ${vad.db.toFixed(0)}dB`
							: `silence · ${vad.db.toFixed(0)}dB`
						: 'idle'}
				</span>
			</div>

			<div className="lesson-segments">
				<div className="lesson-segments-head">
					<span>Confirmed segments</span>
					<span>
						{totalSegments} / {segments.reduce((sum, segment) => sum + segment.text.length, 0)}{' '}
						chars
					</span>
				</div>
				<ol>
					{segments.map((segment) => (
						<li key={segment.id}>
							<span className="lesson-seg-time">
								{segment.start.toFixed(1)}–{segment.end.toFixed(1)}s
							</span>
							<span>{segment.text}</span>
						</li>
					))}
					{segments.length === 0 && (
						<li className="lesson-seg-empty">
							<LoaderCircle size={14} strokeWidth={2} aria-hidden="true" />
							Play a recording to transcribe it sentence by sentence.
						</li>
					)}
				</ol>
			</div>
		</div>
	)
}
