import { useCallback, useEffect, useRef, useState } from 'react'
import type {
	Board,
	CanvasDetail,
	CanvasSnapshot,
	CanvasSummary,
	Operation,
	ServerEvent,
} from '../../shared/types'
import { mergeSnapshotCanvases, rememberBoard, upsertCanvasSummary } from '../canvasState'
import { CanvasHistory, HistoryConflict, type HistoryDirection } from './history'

const WS_URL = new URL('/api/events', window.location.href)
WS_URL.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

interface CanvasSessionViewModelProps {
	announce: (message: string) => void
	onBoardTransition: (previous: Board, next: Board, switching: boolean, canvasId: string) => void
	onBoardAccepted: (next: Board, switching: boolean) => void
}

interface PendingReplay {
	canvasId: string
	revision: number
	history: CanvasHistory
	direction: HistoryDirection
	confirmed?: Board
	uncertain?: boolean
	completed?: boolean
}

export function useCanvasSessionViewModel({
	announce,
	onBoardTransition,
	onBoardAccepted,
}: CanvasSessionViewModelProps) {
	const [board, setBoard] = useState<Board>({ revision: 0, shapes: [] })
	const [canvases, setCanvases] = useState<CanvasSummary[]>([])
	const [activeCanvasId, setActiveCanvasId] = useState('')
	const [apiConnected, setApiConnected] = useState(false)
	const [wsConnected, setWsConnected] = useState(false)
	const revisionRef = useRef(0)
	const boardRef = useRef<Board>({ revision: 0, shapes: [] })
	const operationQueue = useRef<Promise<void>>(Promise.resolve())
	const historiesRef = useRef(new Map<string, CanvasHistory>())
	const replayRef = useRef<PendingReplay | null>(null)
	const [historyWaiting, setHistoryWaiting] = useState(false)
	const [pendingOperations, setPendingOperations] = useState(0)
	const [, refreshHistory] = useState(0)
	const activeCanvasIdRef = useRef('')
	const requestedCanvasIdRef = useRef('')
	const stateVersionRef = useRef(-1)
	const boardCacheRef = useRef<Map<string, Board>>(new Map())
	const canvasesRef = useRef(canvases)
	const announceRef = useRef(announce)
	const onBoardTransitionRef = useRef(onBoardTransition)
	const onBoardAcceptedRef = useRef(onBoardAccepted)
	canvasesRef.current = canvases
	announceRef.current = announce
	onBoardTransitionRef.current = onBoardTransition
	onBoardAcceptedRef.current = onBoardAccepted

	const completeReplay = useCallback((replay: PendingReplay) => {
		if (replay.completed) return
		replay.completed = true
		replay.history.complete(replay.direction)
		refreshHistory((version) => version + 1)
		setHistoryWaiting(false)
		if (replayRef.current === replay) replayRef.current = null
	}, [])

	const cacheBoard = useCallback(
		(canvasId: string, next: Board) => {
			const replay = replayRef.current
			if (
				replay &&
				replay.canvasId === canvasId &&
				replay.revision <= next.revision &&
				replay.history.matchesResult(next, replay.direction)
			) {
				replay.confirmed = next
				if (replay.uncertain) completeReplay(replay)
			}
			rememberBoard(boardCacheRef.current, canvasId, next)
		},
		[completeReplay],
	)

	const applyBoard = useCallback(
		(next: Board) => {
			if (next.revision < revisionRef.current) return
			const canvasId = activeCanvasIdRef.current
			onBoardTransitionRef.current(boardRef.current, next, false, canvasId)
			revisionRef.current = next.revision
			boardRef.current = next
			cacheBoard(canvasId, next)
			setBoard(next)
			onBoardAcceptedRef.current(next, false)
		},
		[cacheBoard],
	)

	const mergeCanvas = useCallback((summary: CanvasSummary) => {
		setCanvases((current) => upsertCanvasSummary(current, summary))
	}, [])

	const applySnapshot = useCallback(
		(snapshot: CanvasSnapshot) => {
			if (snapshot.stateVersion < stateVersionRef.current) return
			stateVersionRef.current = snapshot.stateVersion
			const switching = snapshot.activeCanvasId !== activeCanvasIdRef.current
			activeCanvasIdRef.current = snapshot.activeCanvasId
			requestedCanvasIdRef.current = snapshot.activeCanvasId
			setActiveCanvasId(snapshot.activeCanvasId)
			setCanvases((current) => mergeSnapshotCanvases(current, snapshot.canvases))
			const liveIds = new Set(snapshot.canvases.map((canvas) => canvas.id))
			for (const id of boardCacheRef.current.keys()) {
				if (!liveIds.has(id)) boardCacheRef.current.delete(id)
			}
			for (const id of historiesRef.current.keys()) {
				if (!liveIds.has(id)) historiesRef.current.delete(id)
			}
			if (replayRef.current && !liveIds.has(replayRef.current.canvasId)) {
				replayRef.current = null
				setHistoryWaiting(false)
			}
			cacheBoard(snapshot.activeCanvasId, snapshot.board)
			if (!switching && snapshot.board.revision < revisionRef.current) return
			onBoardTransitionRef.current(
				boardRef.current,
				snapshot.board,
				switching,
				snapshot.activeCanvasId,
			)
			revisionRef.current = snapshot.board.revision
			boardRef.current = snapshot.board
			setBoard(snapshot.board)
			onBoardAcceptedRef.current(snapshot.board, switching)
		},
		[cacheBoard],
	)

	const submitOperations = useCallback(
		(
			command: Operation[] | HistoryDirection,
			expectedRevision?: number,
			canRebase?: (board: Board) => boolean,
		) => {
			const targetCanvasId = activeCanvasIdRef.current
			setPendingOperations((count) => count + 1)
			const result = operationQueue.current.then(async () => {
				try {
					if (!targetCanvasId) return false
					if (replayRef.current?.uncertain) {
						announceRef.current(
							'Waiting to confirm history replay. Reconnect or reload to reset local history.',
						)
						return false
					}
					const targetBoard = boardCacheRef.current.get(targetCanvasId)
					if (!targetBoard) return false
					let history = historiesRef.current.get(targetCanvasId)
					if (!history) {
						history = new CanvasHistory()
						historiesRef.current.set(targetCanvasId, history)
					}
					const operations =
						typeof command === 'string' ? history.plan(targetBoard, command) : command
					if (!operations) return false
					if (canRebase && !canRebase(targetBoard)) {
						announceRef.current('Object changed during drag')
						return false
					}
					const revision = canRebase
						? targetBoard.revision
						: (expectedRevision ?? targetBoard.revision)
					if (typeof command === 'string') {
						replayRef.current = {
							canvasId: targetCanvasId,
							revision: revision + 1,
							history,
							direction: command,
						}
					}
					const response = await fetch('/api/operations', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						signal: AbortSignal.timeout(10000),
						body: JSON.stringify({
							operations,
							expectedRevision: revision,
							canvasId: targetCanvasId,
						}),
					})
					if (!response.ok) {
						const current = await fetch('/api/state?previews=0', {
							signal: AbortSignal.timeout(10000),
						})
						if (current.ok) applySnapshot((await current.json()) as CanvasSnapshot)
						announceRef.current(`Operation failed: HTTP ${response.status}`)
						return false
					}
					const next = (await response.json()) as Board
					if (typeof command === 'string') history.complete(command)
					else history.record(targetBoard, next)
					refreshHistory((version) => version + 1)
					cacheBoard(targetCanvasId, next)
					if (targetCanvasId === activeCanvasIdRef.current) applyBoard(next)
					setApiConnected(true)
					return true
				} catch (error) {
					const replay = replayRef.current
					if (replay && !(error instanceof HistoryConflict)) {
						replay.uncertain = true
						setHistoryWaiting(true)
						if (!replay.confirmed) {
							try {
								const response = await fetch(
									`/api/canvases/${encodeURIComponent(targetCanvasId)}`,
									{ signal: AbortSignal.timeout(3000) },
								)
								if (response.ok)
									cacheBoard(targetCanvasId, ((await response.json()) as CanvasDetail).board)
							} catch {
								// Only a verified successor snapshot proves that the replay committed.
							}
						}
						if (replay.confirmed) {
							completeReplay(replay)
							if (targetCanvasId === activeCanvasIdRef.current) applyBoard(replay.confirmed)
							setApiConnected(true)
							return true
						}
					}
					if (!(error instanceof HistoryConflict)) setApiConnected(false)
					announceRef.current(
						replay?.uncertain
							? 'Waiting to confirm history replay. Reconnect or reload to reset local history.'
							: error instanceof Error
								? error.message
								: 'Operation failed',
					)
					return false
				} finally {
					if (!replayRef.current?.uncertain) replayRef.current = null
					setPendingOperations((count) => count - 1)
				}
			})
			operationQueue.current = result.then(() => undefined)
			return result
		},
		[applyBoard, applySnapshot, cacheBoard, completeReplay],
	)

	const postOperations = useCallback(
		(operations: Operation[], expectedRevision?: number, canRebase?: (board: Board) => boolean) =>
			submitOperations(operations, expectedRevision, canRebase),
		[submitOperations],
	)
	const undo = useCallback(() => submitOperations('undo'), [submitOperations])
	const redo = useCallback(() => submitOperations('redo'), [submitOperations])

	useEffect(() => {
		let stopped = false

		const fetchState = async (includePreviews: boolean) => {
			try {
				const response = await fetch(`/api/state${includePreviews ? '' : '?previews=0'}`, {
					signal: AbortSignal.timeout(10000),
				})
				if (!response.ok) throw new Error(`HTTP ${response.status}`)
				const snapshot = (await response.json()) as CanvasSnapshot
				if (!stopped) {
					applySnapshot(snapshot)
					const replay = replayRef.current
					if (replay?.uncertain && replay.canvasId !== snapshot.activeCanvasId) {
						const detail = await fetch(`/api/canvases/${encodeURIComponent(replay.canvasId)}`, {
							signal: AbortSignal.timeout(3000),
						})
						if (detail.ok && !stopped)
							cacheBoard(replay.canvasId, ((await detail.json()) as CanvasDetail).board)
					}
					setApiConnected(true)
				}
			} catch {
				if (!stopped) setApiConnected(false)
			}
		}

		void fetchState(true)
		const poll = window.setInterval(() => void fetchState(false), 3000)

		let socket: WebSocket | null = null
		let retry: number | null = null

		const connect = () => {
			if (stopped) return
			const current = new WebSocket(WS_URL)
			socket = current
			current.onopen = () => {
				if (!stopped) setWsConnected(true)
			}
			current.onmessage = (event) => {
				if (stopped) return
				try {
					const message = JSON.parse(event.data) as ServerEvent
					if (message.type === 'snapshot') {
						applySnapshot(message)
					} else if (message.type === 'board') {
						cacheBoard(message.canvasId, message.board)
						mergeCanvas(message.canvas)
						if (message.canvasId === activeCanvasIdRef.current) applyBoard(message.board)
					}
					setApiConnected(true)
				} catch {
					announceRef.current('Invalid board event')
				}
			}
			current.onclose = () => {
				if (stopped) return
				setWsConnected(false)
				retry = window.setTimeout(connect, 2000)
			}
			current.onerror = () => current.close()
		}

		queueMicrotask(connect)

		return () => {
			stopped = true
			window.clearInterval(poll)
			if (retry) window.clearTimeout(retry)
			socket?.close()
		}
	}, [applyBoard, applySnapshot, mergeCanvas, cacheBoard])

	const refreshCanvases = useCallback(async () => {
		try {
			const response = await fetch('/api/canvases', { signal: AbortSignal.timeout(10000) })
			if (!response.ok) return
			const data = (await response.json()) as {
				stateVersion: number
				canvases: CanvasSummary[]
			}
			if (data.stateVersion < stateVersionRef.current) return
			stateVersionRef.current = data.stateVersion
			setCanvases((current) => mergeSnapshotCanvases(current, data.canvases))
		} catch {
			// The poll and WebSocket keep the list fresh if this request fails.
		}
	}, [])

	const requestCanvas = useCallback(
		async (path: string, init: RequestInit) => {
			try {
				const response = await fetch(path, {
					...init,
					headers: { 'Content-Type': 'application/json' },
					signal: AbortSignal.timeout(10000),
				})
				if (!response.ok) {
					let message = `Canvas request failed: HTTP ${response.status}`
					try {
						const body = (await response.json()) as { message?: string }
						if (body.message) message = body.message
					} catch {
						// Keep the status fallback.
					}
					announceRef.current(message)
					return
				}
				applySnapshot((await response.json()) as CanvasSnapshot)
				setApiConnected(true)
			} catch (error) {
				setApiConnected(false)
				announceRef.current(error instanceof Error ? error.message : 'Canvas request failed')
			}
		},
		[applySnapshot],
	)

	const createCanvas = useCallback(() => {
		void requestCanvas('/api/canvases', {
			method: 'POST',
			body: JSON.stringify({ name: `Canvas ${canvasesRef.current.length + 1}`, activate: true }),
		})
	}, [requestCanvas])

	const createLessonCanvas = useCallback(
		(name: string) => {
			void requestCanvas('/api/canvases', {
				method: 'POST',
				body: JSON.stringify({ name, activate: true }),
			})
		},
		[requestCanvas],
	)

	const switchCanvas = useCallback(
		(id: string) => {
			requestedCanvasIdRef.current = id
			void requestCanvas('/api/active-canvas', {
				method: 'PUT',
				body: JSON.stringify({ id }),
			})
		},
		[requestCanvas],
	)

	const renameCanvas = useCallback(
		(id: string, name: string) => {
			void requestCanvas(`/api/canvases/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify({ name }),
			})
		},
		[requestCanvas],
	)

	const deleteCanvas = useCallback(
		(id: string) => {
			void requestCanvas(`/api/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		[requestCanvas],
	)

	const getCurrentBoard = useCallback(() => boardRef.current, [])
	const getActiveCanvasId = useCallback(() => activeCanvasIdRef.current, [])
	const isCanvasTargetCurrent = useCallback(
		(canvasId: string) =>
			activeCanvasIdRef.current === canvasId && requestedCanvasIdRef.current === canvasId,
		[],
	)

	const activeCanvasName = canvases.find((canvas) => canvas.id === activeCanvasId)?.name
	useEffect(() => {
		document.title = activeCanvasName ? `mico · ${activeCanvasName}` : 'mico'
	}, [activeCanvasName])

	return {
		board,
		canvases,
		activeCanvasId,
		apiConnected,
		wsConnected,
		postOperations,
		undo,
		redo,
		canUndo:
			!historyWaiting &&
			pendingOperations === 0 &&
			Boolean(historiesRef.current.get(activeCanvasId)?.canUndo),
		canRedo:
			!historyWaiting &&
			pendingOperations === 0 &&
			Boolean(historiesRef.current.get(activeCanvasId)?.canRedo),
		refreshCanvases,
		createCanvas,
		createLessonCanvas,
		switchCanvas,
		renameCanvas,
		deleteCanvas,
		getCurrentBoard,
		getActiveCanvasId,
		isCanvasTargetCurrent,
	}
}
