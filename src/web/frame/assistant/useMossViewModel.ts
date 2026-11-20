import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/index.ts'
import {
	AudioHelperError,
	openAudioHelperPermissions,
	openAudioHelperStream,
} from '../../stt/audioHelper.ts'
import { type MossLiveEvent, MossLiveSession } from '../../stt/mossLive.ts'
import { formatClock } from '../../stt/transcript.ts'
import { drawWave, observeWaveformCanvas } from '../../waveform.ts'
import { type AudioHelperController, useAudioHelper } from './useAudioHelper.ts'

export type MossPhase = 'idle' | 'connecting' | 'listening' | 'error'

export interface UseMossViewModelProps {
	active: boolean
	canvasId: string
	selectedIds: string[]
	onStatusChange?: (status: MossAssistantStatus | null) => void
	audioHelper?: AudioHelperController
}

export interface MossAssistantStatus {
	phase: MossPhase
	activity: string
	detail: string
}

export function mossAssistantActivity(status: MossAssistantStatus) {
	if (status.phase === 'idle') return null
	if (status.phase === 'error') {
		return { state: 'attention', text: status.detail || 'MOSS Live connection error' }
	}
	if (status.detail) return { state: 'attention', text: status.detail }
	if (status.activity.startsWith('Tool failed:')) {
		return { state: 'attention', text: status.activity }
	}
	if (status.phase === 'connecting') {
		return { state: 'work', text: 'MOSS Live is connecting…' }
	}
	return {
		state: 'work',
		text: status.activity === 'Ready to draw' ? 'MOSS Live is listening…' : status.activity,
	}
}

export function mossCompletedToolActivity(name: string, phase: 'done' | 'error') {
	if (phase === 'error') return `Tool failed: ${name.replaceAll('_', ' ')}`
	return name === 'generate_image'
		? 'Image generation started'
		: name === 'image_generation_status'
			? 'Image generation checked'
			: 'Canvas updated'
}

export function nextMossToolActivity(
	pending: number,
	name: string,
	phase: 'started' | 'done' | 'error',
) {
	if (phase === 'started') {
		return { pending: pending + 1, activity: `Drawing: ${name.replaceAll('_', ' ')}` }
	}
	const nextPending = Math.max(0, pending - 1)
	return {
		pending: nextPending,
		activity:
			phase === 'error'
				? mossCompletedToolActivity(name, phase)
				: nextPending > 0
					? 'Drawing…'
					: mossCompletedToolActivity(name, phase),
	}
}

export type MossViewModel = ReturnType<typeof useMossViewModel>

export function useMossViewModel({
	active,
	canvasId,
	selectedIds,
	onStatusChange,
	audioHelper: injectedAudioHelper,
}: UseMossViewModelProps) {
	const { messages } = useI18n()
	const sessionRef = useRef<MossLiveSession | null>(null)
	const startGenerationRef = useRef(0)
	const waveRef = useRef<HTMLCanvasElement>(null)
	const peaks = useRef<number[]>([])
	const pendingTools = useRef(0)
	const keepAliveRef = useRef(false)
	const lastCanvasIdRef = useRef(canvasId)
	const [phase, setPhase] = useState<MossPhase>('idle')
	const [detail, setDetail] = useState('')
	const [elapsed, setElapsed] = useState(0)
	const [transcript, setTranscript] = useState({ user: '', assistant: '' })
	const [activity, setActivity] = useState('Ready to draw')
	const helperPromptRef = useRef(messages.assistant.live.helperPermissionsPrompt)
	helperPromptRef.current = messages.assistant.live.helperPermissionsPrompt
	const clearPermissionPrompt = useCallback(() => {
		setDetail((currentDetail) => (currentDetail === helperPromptRef.current ? '' : currentDetail))
	}, [])
	const ownHelper = useAudioHelper({
		active,
		capturing: phase === 'connecting' || phase === 'listening',
		enabled: !injectedAudioHelper,
		onReady: clearPermissionPrompt,
	})
	const helper = injectedAudioHelper ?? ownHelper
	useEffect(() => {
		if (helper.helperStatus === 'ready') clearPermissionPrompt()
	}, [clearPermissionPrompt, helper.helperStatus])

	useEffect(() => {
		onStatusChange?.({ phase, activity, detail })
	}, [phase, activity, detail, onStatusChange])

	useEffect(() => () => onStatusChange?.(null), [onStatusChange])

	const stop = () => {
		startGenerationRef.current++
		const session = sessionRef.current
		sessionRef.current = null
		session?.stop()
		setPhase('idle')
	}

	useEffect(() => {
		if (lastCanvasIdRef.current !== canvasId) {
			lastCanvasIdRef.current = canvasId
			keepAliveRef.current = false
			startGenerationRef.current++
			const session = sessionRef.current
			sessionRef.current = null
			session?.stop()
			setPhase('idle')
		}
	}, [canvasId])

	useEffect(() => {
		if (active || keepAliveRef.current) return
		startGenerationRef.current++
		const session = sessionRef.current
		sessionRef.current = null
		session?.stop()
		setPhase('idle')
	}, [active])

	useEffect(
		() => () => {
			startGenerationRef.current++
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
		if (!active) return
		return observeWaveformCanvas(canvas, () => canvas && drawWave(canvas, peaks.current, 1, [], 1))
	}, [active])

	const start = async () => {
		if (sessionRef.current) return
		const generation = ++startGenerationRef.current
		setDetail('')
		setElapsed(0)
		setTranscript({ user: '', assistant: '' })
		setActivity('Ready to draw')
		pendingTools.current = 0
		peaks.current = []
		if (waveRef.current) drawWave(waveRef.current, null, 0, [], 0)
		setPhase('connecting')

		const probe = await helper.refreshHelper()
		if (startGenerationRef.current !== generation) return

		// Strict mutual exclusion: whenever Mico Helper is reachable, never fall back
		// to browser getUserMedia.
		if (probe.status === 'needs-permission') {
			setPhase('idle')
			setDetail(helperPromptRef.current)
			void openAudioHelperPermissions()
			return
		}

		const helperCapture =
			probe.status === 'ready'
				? (onPcm: (pcm: Int16Array) => void, onEnded: (error?: Error) => void) =>
						openAudioHelperStream(onPcm, (error) => {
							if (error instanceof AudioHelperError && error.code === 'permissions_required') {
								helper.applyProbe('needs-permission', probe.health?.activeDevice ?? '')
								void openAudioHelperPermissions()
							}
							onEnded(error)
						}).catch((error: unknown) => {
							if (error instanceof AudioHelperError && error.code === 'permissions_required') {
								helper.applyProbe('needs-permission', probe.health?.activeDevice ?? '')
								void openAudioHelperPermissions()
							}
							throw error
						})
				: undefined

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
				const next = nextMossToolActivity(pendingTools.current, event.name, event.phase)
				pendingTools.current = next.pending
				setActivity(next.activity)
			} else if (event.type === 'audio') {
				peaks.current.push(event.min, event.max)
				if (peaks.current.length > 1200) peaks.current.splice(0, peaks.current.length - 1200)
				if (waveRef.current) drawWave(waveRef.current, peaks.current, 1, [], 1)
			}
		}
		session = new MossLiveSession({
			canvasId,
			selection: [...selectedIds],
			onEvent,
			captureFactory: helperCapture,
		})
		sessionRef.current = session
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
				? messages.assistant.live.phaseListening
				: phase === 'connecting'
					? messages.assistant.live.phaseConnecting
					: phase === 'error'
						? messages.assistant.live.mossPhaseError
						: messages.assistant.live.phaseReady,
		detail,
		elapsed: formatClock(elapsed),
		transcript,
		activity,
		showActivity: phase === 'listening' || activity !== 'Ready to draw',
		running,
		hasTranscript,
		hasOutput: running || hasTranscript,
		audioSource: helper.audioSource,
		helperStatus: helper.helperStatus,
		helperDevice: helper.helperDevice,
		openHelperPermissions: helper.openHelperPermissions,
		start: () => {
			keepAliveRef.current = false
			void start()
		},
		stop: () => {
			keepAliveRef.current = false
			stop()
		},
		toggleFromTopbar: () => {
			if (running) {
				keepAliveRef.current = false
				stop()
			} else {
				keepAliveRef.current = true
				void start()
			}
		},
	}
}
