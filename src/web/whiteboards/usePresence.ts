import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { Point } from '../../shared/types'
import type {
	PresenceEvent,
	PresenceMessage,
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
	const [following, setFollowing] = useState(true)
	const followingRef = useRef(true)
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
				presenterView.current = event.viewport
				if (!session?.member.sharer && followingRef.current && event.viewport)
					applyPresenter(event.viewport)
			} else if (event.type === 'cursor') {
				setMembers((current) =>
					current.map((member) =>
						member.id === event.memberId ? { ...member, cursor: event.point } : member,
					),
				)
			} else {
				presenterView.current = event.viewport
				if (!session?.member.sharer && followingRef.current) applyPresenter(event.viewport)
			}
		},
		[applyPresenter, session?.member.sharer],
	)
	const queueView = useCallback(
		(current: Viewport = viewportRef.current) => {
			if (!session?.member.sharer) return
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
		if (!session) return
		const interval = window.setInterval(() => {
			if (pending.current.cursor !== undefined)
				send.current({ type: 'cursor', point: pending.current.cursor })
			if (pending.current.view)
				send.current({ type: 'presenter-view', viewport: pending.current.view })
			pending.current = {}
		}, 50)
		const resize = () => {
			queueView()
			if (!session.member.sharer && followingRef.current && presenterView.current)
				applyPresenter(presenterView.current)
		}
		const observer = new ResizeObserver(resize)
		if (canvas.current) observer.observe(canvas.current)
		return () => {
			window.clearInterval(interval)
			observer.disconnect()
		}
	}, [session, canvas, queueView, applyPresenter])
	const detach = useCallback(() => {
		if (!session || session.member.sharer) return
		followingRef.current = false
		setFollowing(false)
	}, [session])
	const follow = () => {
		followingRef.current = true
		setFollowing(true)
		if (presenterView.current) applyPresenter(presenterView.current)
	}
	const pointer = (point: Point | null) => {
		cursorScreen.current = point
		queueCursor()
	}
	return { members, presenterId, following, detach, follow, pointer, send, queueView, onEvent }
}
