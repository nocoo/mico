import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { Point } from '../../shared/types'
import type {
	PresenceEvent,
	PresenceMessage,
	PresenterInvite,
	PresenterView,
	WhiteboardMember,
	WhiteboardSession,
} from '../../shared/whiteboards'

type Viewport = { x: number; y: number; zoom: number }

export function usePresence(
	session: WhiteboardSession | undefined,
	canvas: RefObject<SVGSVGElement | null>,
	viewport: Viewport,
	setViewport: (view: Viewport) => void,
) {
	const [members, setMembers] = useState<WhiteboardMember[]>([])
	const [presenterId, setPresenterId] = useState<string | null>(null)
	const [requesterIds, setRequesterIds] = useState<string[]>([])
	const [presenterInvite, setPresenterInvite] = useState<PresenterInvite | null>(null)
	const [presenterLive, setPresenterLive] = useState<{ text: string; active: boolean } | null>(null)
	const [following, setFollowing] = useState(true)
	const followingRef = useRef(true)
	const sharerRef = useRef(Boolean(session?.member.sharer))
	sharerRef.current = Boolean(session?.member.sharer)
	const sessionIdRef = useRef(session?.member.id ?? null)
	sessionIdRef.current = session?.member.id ?? null
	const presenterView = useRef<PresenterView | null>(null)
	const send = useRef<(message: PresenceMessage) => void>(() => {})
	const pending = useRef<{ cursor?: Point | null; view?: PresenterView }>({})
	const cursorScreen = useRef<Point | null>(null)
	const viewportRef = useRef(viewport)
	viewportRef.current = viewport
	const setViewportRef = useRef(setViewport)
	setViewportRef.current = setViewport
	const applyPresenter = useCallback(
		(view: PresenterView) => {
			const rect = canvas.current?.getBoundingClientRect()
			if (rect)
				setViewportRef.current({
					x: rect.width / 2 - view.centerX * view.zoom,
					y: rect.height / 2 - view.centerY * view.zoom,
					zoom: view.zoom,
				})
		},
		[canvas],
	)
	const onEvent = useCallback(
		(event: PresenceEvent) => {
			if (event.type === 'presence') {
				setMembers(event.members)
				setPresenterId(event.presenterId)
				setRequesterIds(event.requesterIds ?? [])
				setPresenterInvite(event.presenterInvite ?? null)
				setPresenterLive(
					event.liveTranscript && (event.liveTranscript.active || event.liveTranscript.text)
						? { text: event.liveTranscript.text, active: event.liveTranscript.active }
						: null,
				)
				presenterView.current = event.viewport
				const isSharer = event.presenterId
					? event.presenterId === sessionIdRef.current
					: Boolean(session?.member.sharer)
				sharerRef.current = isSharer
				if (!isSharer && followingRef.current && event.viewport) applyPresenter(event.viewport)
			} else if (event.type === 'cursor') {
				setMembers((current) =>
					current.map((member) =>
						member.id === event.memberId ? { ...member, cursor: event.point } : member,
					),
				)
			} else if (event.type === 'live-transcript') {
				setPresenterLive(
					event.active || event.text ? { text: event.text, active: event.active } : null,
				)
			} else {
				presenterView.current = event.viewport
				if (!sharerRef.current && followingRef.current) applyPresenter(event.viewport)
			}
		},
		[applyPresenter, session?.member.sharer],
	)
	const queueView = useCallback(
		(current: Viewport = viewportRef.current) => {
			if (!session?.member.sharer || !sharerRef.current) return
			const rect = canvas.current?.getBoundingClientRect()
			if (rect)
				pending.current.view = {
					centerX: (rect.width / 2 - current.x) / current.zoom,
					centerY: (rect.height / 2 - current.y) / current.zoom,
					zoom: current.zoom,
				}
		},
		[canvas, session?.member.sharer],
	)
	const queueCursor = useCallback(() => {
		const point = cursorScreen.current
		const current = viewportRef.current
		pending.current.cursor = point
			? {
					x: (point.x - current.x) / current.zoom,
					y: (point.y - current.y) / current.zoom,
				}
			: null
	}, [])
	useEffect(() => {
		queueView(viewport)
		if (cursorScreen.current) queueCursor()
	}, [queueView, queueCursor, viewport])
	useEffect(() => {
		if (!session) {
			setRequesterIds([])
			setPresenterInvite(null)
			setPresenterLive(null)
			return
		}
		const interval = window.setInterval(() => {
			if (pending.current.cursor !== undefined)
				send.current({ type: 'cursor', point: pending.current.cursor })
			if (pending.current.view && sharerRef.current)
				send.current({ type: 'presenter-view', viewport: pending.current.view })
			pending.current = {}
		}, 50)
		const resize = () => {
			queueView()
			if (!sharerRef.current && followingRef.current && presenterView.current)
				applyPresenter(presenterView.current)
		}
		const observer = new ResizeObserver(resize)
		if (canvas.current) observer.observe(canvas.current)
		return () => {
			window.clearInterval(interval)
			observer.disconnect()
		}
	}, [session, canvas, queueView, applyPresenter])
	const liveBroadcastRef = useRef<{
		lastSentAt: number
		lastText: string
		lastActive: boolean
		pending: { text: string; active: boolean } | null
		timer: number | null
	}>({ lastSentAt: 0, lastText: '', lastActive: false, pending: null, timer: null })

	useEffect(
		() => () => {
			if (liveBroadcastRef.current.timer !== null) {
				window.clearTimeout(liveBroadcastRef.current.timer)
				liveBroadcastRef.current.timer = null
			}
		},
		[],
	)

	const publishLiveTranscript = useCallback((text: string, active: boolean) => {
		if (!sharerRef.current) return
		const clipped = text.trim().slice(-160)
		const state = liveBroadcastRef.current
		if (clipped === state.lastText && active === state.lastActive) return
		const flush = (payload: { text: string; active: boolean }) => {
			state.lastSentAt = Date.now()
			state.lastText = payload.text
			state.lastActive = payload.active
			state.pending = null
			send.current({ type: 'live-transcript', text: payload.text, active: payload.active })
		}
		const now = Date.now()
		const elapsed = now - state.lastSentAt
		if (active !== state.lastActive || elapsed >= 160) {
			if (state.timer !== null) {
				window.clearTimeout(state.timer)
				state.timer = null
			}
			flush({ text: clipped, active })
			return
		}
		state.pending = { text: clipped, active }
		if (state.timer === null) {
			state.timer = window.setTimeout(() => {
				state.timer = null
				if (state.pending && sharerRef.current) flush(state.pending)
			}, 160 - elapsed)
		}
	}, [])

	const detach = useCallback(() => {
		if (!session || sharerRef.current) return
		followingRef.current = false
		setFollowing(false)
	}, [session])
	const follow = useCallback(() => {
		followingRef.current = true
		setFollowing(true)
		if (presenterView.current) applyPresenter(presenterView.current)
	}, [applyPresenter])
	const pointer = (point: Point | null) => {
		cursorScreen.current = point
		queueCursor()
	}
	const requestPresenter = useCallback((requested: boolean) => {
		send.current({ type: 'request-presenter', requested })
	}, [])
	const transferPresenter = useCallback((targetMemberId: string) => {
		sharerRef.current = false
		delete pending.current.view
		send.current({ type: 'transfer-presenter', targetMemberId })
	}, [])
	const declinePresenter = useCallback((targetMemberId: string) => {
		send.current({ type: 'decline-presenter', targetMemberId })
	}, [])
	const invitePresenter = useCallback((targetMemberId: string) => {
		send.current({ type: 'invite-presenter', targetMemberId })
	}, [])
	const respondPresenterInvite = useCallback((accept: boolean) => {
		send.current({ type: 'respond-presenter-invite', accept })
	}, [])
	return {
		members,
		presenterId,
		requesterIds,
		presenterInvite,
		presenterLive,
		following,
		detach,
		follow,
		pointer,
		send,
		queueView,
		onEvent,
		publishLiveTranscript,
		requestPresenter,
		transferPresenter,
		declinePresenter,
		invitePresenter,
		respondPresenterInvite,
	}
}
