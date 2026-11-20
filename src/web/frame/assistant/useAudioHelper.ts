import { useCallback, useEffect, useRef, useState } from 'react'
import {
	type AudioHelperProbeResult,
	type AudioHelperStatus,
	openAudioHelperPermissions,
	probeAudioHelper,
} from '../../stt/audioHelper.ts'

export type LiveAudioSource = 'helper' | 'browser'

export interface AudioHelperController {
	readonly audioSource: LiveAudioSource
	readonly helperStatus: AudioHelperStatus
	readonly helperDevice: string
	readonly openHelperPermissions: () => void
	readonly refreshHelper: () => Promise<AudioHelperProbeResult>
	readonly applyProbe: (status: AudioHelperStatus, device: string) => void
}

export function useAudioHelper({
	active,
	capturing,
	enabled = true,
	onReady,
}: {
	readonly active: boolean
	readonly capturing: boolean
	readonly enabled?: boolean
	readonly onReady?: () => void
}): AudioHelperController {
	const [helperStatus, setHelperStatus] = useState<AudioHelperStatus>('unavailable')
	const [helperDevice, setHelperDevice] = useState('')
	const mountedRef = useRef(true)
	const probeInFlightRef = useRef<Promise<AudioHelperProbeResult> | null>(null)
	const onReadyRef = useRef(onReady)
	onReadyRef.current = onReady

	const applyProbe = useCallback((status: AudioHelperStatus, device: string) => {
		if (!mountedRef.current) return
		setHelperStatus(status)
		setHelperDevice(device)
		if (status === 'ready') onReadyRef.current?.()
	}, [])

	const refreshHelper = useCallback(async (): Promise<AudioHelperProbeResult> => {
		if (!enabled) return { status: 'unavailable', health: null }
		if (probeInFlightRef.current) return probeInFlightRef.current
		const task = probeAudioHelper()
			.then((result) => {
				applyProbe(result.status, result.health?.activeDevice ?? '')
				return result
			})
			.finally(() => {
				if (probeInFlightRef.current === task) probeInFlightRef.current = null
			})
		probeInFlightRef.current = task
		return task
	}, [applyProbe, enabled])

	const openHelperPermissions = useCallback(() => {
		if (!enabled) return
		void openAudioHelperPermissions().then(() => {
			void refreshHelper()
		})
	}, [enabled, refreshHelper])

	useEffect(() => {
		mountedRef.current = true
		if (!enabled) {
			return () => {
				mountedRef.current = false
			}
		}
		void refreshHelper()
		const handleFocus = () => {
			void refreshHelper()
		}
		const handleVisibility = () => {
			if (document.visibilityState === 'visible') void refreshHelper()
		}
		window.addEventListener('focus', handleFocus)
		document.addEventListener('visibilitychange', handleVisibility)
		return () => {
			mountedRef.current = false
			window.removeEventListener('focus', handleFocus)
			document.removeEventListener('visibilitychange', handleVisibility)
		}
	}, [enabled, refreshHelper])

	useEffect(() => {
		if (!enabled || capturing) return
		if (helperStatus === 'unavailable' && !active) return
		const intervalMs = helperStatus === 'unavailable' ? 5000 : 3000
		const timer = window.setInterval(() => {
			void refreshHelper()
		}, intervalMs)
		return () => window.clearInterval(timer)
	}, [active, capturing, enabled, helperStatus, refreshHelper])

	return {
		audioSource: helperStatus === 'unavailable' ? 'browser' : 'helper',
		helperStatus,
		helperDevice,
		openHelperPermissions,
		refreshHelper,
		applyProbe,
	}
}
