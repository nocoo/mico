import bootstrapCss from 'bootstrap/dist/css/bootstrap.min.css?raw'
import bootstrapJs from 'bootstrap/dist/js/bootstrap.bundle.min.js?raw'
import { CodeXml, Frame } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FRAME_FILL_PERCENT } from '../shared/palette'
import type {
	Board,
	BrushStyle,
	CanvasShape,
	CanvasSnapshot,
	CanvasSummary,
	Connector,
	Operation,
	Point,
	ServerEvent,
	Shape,
} from '../shared/types'
import { getAnchors, getConnectorAnchors } from './anchors'
import { BlueprintGrid } from './BlueprintGrid'
import { BrushStroke } from './BrushStroke'
import { CardHeaderPill } from './CardHeaderPill'
import { ConnectionOverlay } from './ConnectionOverlay'
import { mergeSnapshotCanvases, rememberBoard, upsertCanvasSummary } from './canvasState'
import { canRebaseConnector } from './connections'
import { membershipAfterMove, membershipFor } from './containers'
import {
	CANDY_COLORS,
	CANDY_LAYOUT,
	CANDY_TINTS,
	CONTROL_SIZE,
	candyInk,
	candyLine,
	candyWash,
	FONT_STACKS,
	ICON_SIZE,
	TEXT_SIZE,
	type Tool,
} from './design'
import { AssistantFrame } from './frame/assistant'
import type { BrushWidth, DockLayout } from './frame/contracts'
import { EmptyState } from './frame/empty/EmptyState'
import { useEmptyStateViewModel } from './frame/empty/useEmptyStateViewModel'
import { IdentityFrame } from './frame/identity'
import { FRAME_LAYOUT } from './frame/layout'
import { Toolbar } from './frame/toolbar'
import { HTML_CARD_SANDBOX, htmlCardDocument } from './htmlCard'
import {
	imagePreserveAspectRatio,
	isSupportedImageFile,
	readImageDimensions,
	scaleImageDimensions,
} from './image'
import { canRebaseMoveGroup } from './move'
import { SelectionPanel } from './SelectionPanel'
import { StickyNote } from './StickyNote'
import {
	boundsOf,
	expandRect,
	normalizeRect,
	type Rect,
	selectInRect,
	shapeBounds,
} from './selection'
import { type AlignmentGuide, snapMove } from './snap'
import { useConnectionGesture } from './useConnectionGesture'
import { fitViewport } from './viewport'

const WS_URL = new URL('/api/events', window.location.href)
WS_URL.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

const isConnector = (shape: Shape): shape is Connector => shape.type === 'connector'
const isCanvasShape = (shape: Shape): shape is CanvasShape => shape.type !== 'connector'

const randomId = () => crypto.randomUUID()

function ShapeLabel({ text, x, y, fill }: { text: string; x: number; y: number; fill: string }) {
	const lines = text.split('\n').map((line, index) => ({ line, key: `${index}-${line}` }))
	const lineHeight = 18
	return (
		<text x={x} y={y} fill={fill} textAnchor="middle" dominantBaseline="middle">
			{lines.map(({ line, key }, index) => (
				<tspan
					key={key}
					x={x}
					dy={index === 0 ? `${(-(lines.length - 1) * lineHeight) / 2}px` : `${lineHeight}px`}
				>
					{line || ' '}
				</tspan>
			))}
		</text>
	)
}

export default function App() {
	const svgRef = useRef<SVGSVGElement>(null)
	const revisionRef = useRef(0)
	const boardRef = useRef<Board>({ revision: 0, shapes: [] })
	const animatedNotesRef = useRef(new Set<string>())
	const operationQueue = useRef<Promise<void>>(Promise.resolve())
	const interactionRef = useRef<{
		mode: 'pan' | 'shape' | 'create' | 'connection' | 'brush' | 'marquee'
		pointerId: number
		startClient: { x: number; y: number }
		startWorld: { x: number; y: number }
		startViewport: { x: number; y: number }
		revision?: number
		previewToken?: number
		shape?: CanvasShape
		group?: CanvasShape[]
	} | null>(null)
	const dragTokenRef = useRef(0)

	const [board, setBoard] = useState<Board>({ revision: 0, shapes: [] })
	const [canvases, setCanvases] = useState<CanvasSummary[]>([])
	const [activeCanvasId, setActiveCanvasId] = useState('')
	const activeCanvasIdRef = useRef('')
	const requestedCanvasIdRef = useRef('')
	const imageInputRef = useRef<HTMLInputElement>(null)
	const stateVersionRef = useRef(-1)
	const boardCacheRef = useRef<Map<string, Board>>(new Map())
	const connectionResetRef = useRef<() => void>(() => {})
	const [canvasPanelOpen, setCanvasPanelOpen] = useState(false)
	const [aiPrompt, setAiPrompt] = useState(
		() => new URLSearchParams(window.location.search).get('ai')?.trim() ?? '',
	)
	const [aiPanelOpen, setAiPanelOpen] = useState(
		() => aiPrompt.length > 0 || window.innerWidth >= 900,
	)
	const emptyState = useEmptyStateViewModel({
		canvasId: activeCanvasId,
		shapeCount: board.shapes.length,
		initialPrompt: aiPrompt,
		openAssistant: () => setAiPanelOpen(true),
	})
	const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
	const [dockLayout, setDockLayout] = useState<DockLayout | null>(null)
	const [tool, setTool] = useState<Tool>('select')
	const [selectedIds, setSelectedIds] = useState<string[]>([])
	const [marquee, setMarquee] = useState<Rect | null>(null)
	const [editing, setEditing] = useState<{
		id: string
		field: 'text' | 'title'
		value: string
	} | null>(null)
	const [noteColor, setNoteColor] = useState<string>(CANDY_TINTS.yellow)
	const [textFont, setTextFont] = useState<'sans' | 'serif' | 'hand' | 'mono'>('sans')
	const [textSize, setTextSize] = useState(32)
	const [textWeight, setTextWeight] = useState(500)
	const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
	const selectOnly = (id: string | null) => setSelectedIds(id ? [id] : [])
	const [creation, setCreation] = useState<CanvasShape | null>(null)
	const [dragPreviews, setDragPreviews] = useState<
		Map<string, { x: number; y: number; token: number }>
	>(() => new Map())
	const [apiConnected, setApiConnected] = useState(false)
	const [wsConnected, setWsConnected] = useState(false)
	const [guides, setGuides] = useState<AlignmentGuide[]>([])
	const [brushPoints, setBrushPoints] = useState<Point[] | null>(null)
	const [brushStyle, setBrushStyle] = useState<BrushStyle>('brush')
	const [brushWidth, setBrushWidth] = useState<BrushWidth>(4)
	const [notice, setNotice] = useState('')
	const [spacePressed, setSpacePressed] = useState(false)
	const [isPanning, setIsPanning] = useState(false)

	const activeCanvasName = canvases.find((canvas) => canvas.id === activeCanvasId)?.name
	useEffect(() => {
		document.title = activeCanvasName ? `mico · ${activeCanvasName}` : 'mico'
	}, [activeCanvasName])

	const selected = board.shapes.find((shape) => shape.id === selectedId) ?? null
	const reportDockLayout = useCallback((layout: DockLayout | null) => {
		setDockLayout((current) =>
			current?.height === layout?.height && current?.left === layout?.left ? current : layout,
		)
	}, [])

	const announce = useCallback((message: string) => {
		setNotice(message)
		window.setTimeout(() => setNotice((current) => (current === message ? '' : current)), 2600)
	}, [])

	const cancelInteractionRef = useRef<() => void>(() => {})

	const trackNewNotes = useCallback((next: Board, switching: boolean) => {
		if (switching) {
			animatedNotesRef.current.clear()
			return
		}
		const previousIds = new Set(boardRef.current.shapes.map((shape) => shape.id))
		const noteIds = new Set(
			next.shapes.filter((shape) => shape.type === 'note').map((shape) => shape.id),
		)
		for (const id of animatedNotesRef.current) {
			if (!noteIds.has(id)) animatedNotesRef.current.delete(id)
		}
		for (const id of noteIds) {
			if (!previousIds.has(id)) animatedNotesRef.current.add(id)
		}
	}, [])

	const applyBoard = useCallback(
		(next: Board) => {
			if (next.revision < revisionRef.current) return
			trackNewNotes(next, false)
			revisionRef.current = next.revision
			boardRef.current = next
			rememberBoard(boardCacheRef.current, activeCanvasIdRef.current, next)
			setBoard(next)
			setSelectedIds((current) =>
				current.filter((id) => next.shapes.some((shape) => shape.id === id)),
			)
		},
		[trackNewNotes],
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
			rememberBoard(boardCacheRef.current, snapshot.activeCanvasId, snapshot.board)
			if (!switching && snapshot.board.revision < revisionRef.current) return
			trackNewNotes(snapshot.board, switching)
			revisionRef.current = snapshot.board.revision
			boardRef.current = snapshot.board
			setBoard(snapshot.board)
			if (switching) {
				cancelInteractionRef.current()
				connectionResetRef.current()
				setSelectedIds([])
				setEditing(null)
				setMarquee(null)
				setGuides([])
				setDragPreviews(new Map())
				setCreation(null)
				setBrushPoints(null)
				const rect = svgRef.current?.getBoundingClientRect()
				if (rect) setViewport(fitViewport(snapshot.board.shapes, rect.width, rect.height))
				return
			}
			setSelectedIds((current) =>
				current.filter((id) => snapshot.board.shapes.some((shape) => shape.id === id)),
			)
		},
		[trackNewNotes],
	)

	const postOperations = useCallback(
		(operations: Operation[], expectedRevision?: number, canRebase?: (board: Board) => boolean) => {
			const targetCanvasId = activeCanvasIdRef.current
			const result = operationQueue.current.then(async () => {
				try {
					if (!targetCanvasId) return false
					const targetBoard = boardCacheRef.current.get(targetCanvasId) ?? boardRef.current
					if (canRebase && !canRebase(targetBoard)) {
						announce('Object changed during drag')
						return false
					}
					const revision = canRebase
						? targetBoard.revision
						: (expectedRevision ?? targetBoard.revision)
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
						announce(`Operation failed: HTTP ${response.status}`)
						return false
					}
					const next = (await response.json()) as Board
					rememberBoard(boardCacheRef.current, targetCanvasId, next)
					if (targetCanvasId === activeCanvasIdRef.current) applyBoard(next)
					setApiConnected(true)
					return true
				} catch (error) {
					setApiConnected(false)
					announce(error instanceof Error ? error.message : 'Operation failed')
					return false
				}
			})
			operationQueue.current = result.then(() => undefined)
			return result
		},
		[announce, applyBoard, applySnapshot],
	)

	const connection = useConnectionGesture(board, viewport.zoom, postOperations)

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
						rememberBoard(boardCacheRef.current, message.canvasId, message.board)
						mergeCanvas(message.canvas)
						if (message.canvasId === activeCanvasIdRef.current) applyBoard(message.board)
					}
					setApiConnected(true)
				} catch {
					announce('Invalid board event')
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
	}, [announce, applyBoard, applySnapshot, mergeCanvas])

	const clientToWorld = (clientX: number, clientY: number) => {
		const rect = svgRef.current?.getBoundingClientRect()
		if (!rect) return { x: 0, y: 0 }
		return {
			x: (clientX - rect.left - viewport.x) / viewport.zoom,
			y: (clientY - rect.top - viewport.y) / viewport.zoom,
		}
	}

	const zoomAt = useCallback(
		(nextZoom: number, clientX?: number, clientY?: number) => {
			const rect = svgRef.current?.getBoundingClientRect()
			const cx = clientX === undefined ? (rect?.left ?? 0) + (rect?.width ?? 0) / 2 : clientX
			const cy = clientY === undefined ? (rect?.top ?? 0) + (rect?.height ?? 0) / 2 : clientY
			const rx = cx - (rect?.left ?? 0)
			const ry = cy - (rect?.top ?? 0)
			const zoom = Math.min(3, Math.max(0.05, nextZoom))
			const worldX = (rx - viewport.x) / viewport.zoom
			const worldY = (ry - viewport.y) / viewport.zoom
			setViewport({ x: rx - worldX * zoom, y: ry - worldY * zoom, zoom })
		},
		[viewport],
	)

	const fitBoard = useCallback(() => {
		const rect = svgRef.current?.getBoundingClientRect()
		if (rect) setViewport(fitViewport(boardRef.current.shapes, rect.width, rect.height))
	}, [])

	const createShape = (shape: CanvasShape) => {
		const frameId =
			shape.type === 'frame'
				? null
				: membershipFor(boardRef.current.shapes, shapeBounds(shape), shape.id)
		selectOnly(shape.id)
		void postOperations([{ type: 'create', shape: frameId ? { ...shape, frameId } : shape }])
	}

	const uploadImage = async (file: File) => {
		setTool('select')
		if (!isSupportedImageFile(file)) {
			announce('Choose a PNG, JPEG, WebP, or GIF image')
			return
		}

		const targetCanvasId = activeCanvasIdRef.current
		if (!targetCanvasId) {
			announce('Canvas is not ready')
			return
		}
		const rect = svgRef.current?.getBoundingClientRect()
		const center = rect
			? clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
			: { x: 0, y: 0 }

		try {
			const natural = await readImageDimensions(file)
			if (
				activeCanvasIdRef.current !== targetCanvasId ||
				requestedCanvasIdRef.current !== targetCanvasId
			) {
				announce('Image upload canceled because the canvas changed')
				return
			}
			const size = scaleImageDimensions(natural.w, natural.h)
			const response = await fetch('/api/images', {
				method: 'POST',
				headers: { 'Content-Type': file.type },
				body: file,
				signal: AbortSignal.timeout(10000),
			})
			if (!response.ok) {
				let message = `Image upload failed: HTTP ${response.status}`
				try {
					const body = (await response.json()) as { message?: string }
					if (body.message) message = body.message
				} catch {
					// Keep the status fallback.
				}
				throw new Error(message)
			}
			const body = (await response.json()) as { id?: string }
			if (!body.id) throw new Error('Image upload returned no asset ID')
			if (
				activeCanvasIdRef.current !== targetCanvasId ||
				requestedCanvasIdRef.current !== targetCanvasId
			) {
				announce('Image uploaded, but the canvas changed')
				return
			}
			createShape({
				id: randomId(),
				type: 'image',
				x: center.x - size.w / 2,
				y: center.y - size.h / 2,
				w: size.w,
				h: size.h,
				color: CANDY_COLORS.ink,
				imageId: body.id,
			})
		} catch (error) {
			announce(error instanceof Error ? error.message : 'Image upload failed')
		}
	}

	const deleteSelected = useCallback(() => {
		if (selectedIds.length === 0) return
		void postOperations(selectedIds.map((id) => ({ type: 'delete', id })))
	}, [postOperations, selectedIds])

	const clearDragPreview = useCallback((id: string, token: number) => {
		setDragPreviews((current) => {
			if (current.get(id)?.token !== token) return current
			const next = new Map(current)
			next.delete(id)
			return next
		})
	}, [])

	const cancelInteraction = useCallback(() => {
		const interaction = interactionRef.current
		interactionRef.current = null
		setCreation(null)
		setIsPanning(false)
		setGuides([])
		setBrushPoints(null)
		setMarquee(null)
		connection.cancel()
		if (interaction?.previewToken && interaction.group) {
			for (const shape of interaction.group) clearDragPreview(shape.id, interaction.previewToken)
		}
		if (interaction && svgRef.current?.hasPointerCapture(interaction.pointerId)) {
			svgRef.current.releasePointerCapture(interaction.pointerId)
		}
	}, [clearDragPreview, connection.cancel])

	useEffect(() => {
		cancelInteractionRef.current = cancelInteraction
	}, [cancelInteraction])

	useEffect(() => {
		connectionResetRef.current = connection.reset
	}, [connection.reset])

	const closeCanvasPanel = useCallback(() => setCanvasPanelOpen(false), [])
	const closeAiPanel = useCallback(() => setAiPanelOpen(false), [])
	const clearSelection = useCallback(() => setSelectedIds([]), [])
	const consumeAiPrompt = useCallback(() => setAiPrompt(''), [])
	const isGestureActive = useCallback(() => interactionRef.current !== null, [])

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

	const toggleCanvasPanel = () => {
		setCanvasPanelOpen((open) => {
			if (!open) void refreshCanvases()
			return !open
		})
	}

	const requestCanvas = async (path: string, init: RequestInit) => {
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
				announce(message)
				return
			}
			applySnapshot((await response.json()) as CanvasSnapshot)
			setApiConnected(true)
		} catch (error) {
			setApiConnected(false)
			announce(error instanceof Error ? error.message : 'Canvas request failed')
		}
	}

	const createCanvas = () => {
		void requestCanvas('/api/canvases', {
			method: 'POST',
			body: JSON.stringify({ name: `Canvas ${canvases.length + 1}`, activate: true }),
		})
	}

	const createLessonCanvas = (name: string) => {
		void requestCanvas('/api/canvases', {
			method: 'POST',
			body: JSON.stringify({ name, activate: true }),
		})
	}

	const switchCanvas = (id: string) => {
		requestedCanvasIdRef.current = id
		void requestCanvas('/api/active-canvas', {
			method: 'PUT',
			body: JSON.stringify({ id }),
		})
	}

	const renameCanvas = (id: string, name: string) => {
		void requestCanvas(`/api/canvases/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body: JSON.stringify({ name }),
		})
	}

	const deleteCanvas = (id: string) => {
		void requestCanvas(`/api/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' })
	}

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement
			if (event.key === 'Escape') {
				cancelInteraction()
				setTool('select')
				return
			}
			if (target.closest('input, textarea, select, [contenteditable="true"]')) return
			if (event.metaKey || event.ctrlKey || event.altKey) return
			const interactive = target.closest('button, a[href], [role="button"]')
			const canvasControl = target.closest('.drawing-tools button, .view-controls button')
			if (event.code === 'Space' && interactive && !canvasControl) return

			if (event.code === 'Space') {
				event.preventDefault()
				setSpacePressed(true)
			}
		}
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.code === 'Space') setSpacePressed(false)
		}
		const onBlur = () => {
			setSpacePressed(false)
			cancelInteraction()
		}
		window.addEventListener('keydown', onKeyDown)
		window.addEventListener('keyup', onKeyUp)
		window.addEventListener('blur', onBlur)
		return () => {
			window.removeEventListener('keydown', onKeyDown)
			window.removeEventListener('keyup', onKeyUp)
			window.removeEventListener('blur', onBlur)
		}
	}, [cancelInteraction])

	const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
		if (interactionRef.current || (event.button !== 0 && event.button !== 1)) return

		const shouldPan = event.button === 1 || spacePressed || tool === 'hand'
		if (shouldPan) {
			event.preventDefault()
			svgRef.current?.setPointerCapture(event.pointerId)
			setIsPanning(true)
			interactionRef.current = {
				mode: 'pan',
				pointerId: event.pointerId,
				startClient: { x: event.clientX, y: event.clientY },
				startWorld: { x: 0, y: 0 },
				startViewport: { x: viewport.x, y: viewport.y },
			}
			return
		}

		if (tool === 'select') {
			event.preventDefault()
			svgRef.current?.setPointerCapture(event.pointerId)
			const start = clientToWorld(event.clientX, event.clientY)
			interactionRef.current = {
				mode: 'marquee',
				pointerId: event.pointerId,
				startClient: { x: event.clientX, y: event.clientY },
				startWorld: start,
				startViewport: { x: 0, y: 0 },
			}
			setMarquee({ x: start.x, y: start.y, w: 0, h: 0 })
			return
		}

		if (tool === 'connector') {
			setSelectedIds([])
			return
		}

		const world = clientToWorld(event.clientX, event.clientY)
		if (tool === 'text') {
			createShape({
				id: randomId(),
				type: 'text',
				x: world.x - 160,
				y: world.y - textSize,
				w: 320,
				h: Math.round(textSize * 1.6),
				color: CANDY_LAYOUT.textPreset,
				text: 'Type something',
				font: textFont,
				fontSize: textSize,
				fontWeight: textWeight,
			})
			setTool('select')
			return
		}

		if (tool === 'note') {
			createShape({
				id: randomId(),
				type: 'note',
				x: world.x - 80,
				y: world.y - 80,
				w: 160,
				h: 160,
				color: noteColor,
				text: 'Note',
			})
			setTool('select')
			return
		}

		if (tool === 'html') {
			createShape({
				id: randomId(),
				type: 'html',
				x: world.x - 260,
				y: world.y - 180,
				w: 520,
				h: 360,
				color: CANDY_COLORS.blue,
				title: 'HTML card',
				html: '',
			})
			setTool('select')
			return
		}

		if (tool === 'path') {
			event.preventDefault()
			svgRef.current?.setPointerCapture(event.pointerId)
			interactionRef.current = {
				mode: 'brush',
				pointerId: event.pointerId,
				startClient: { x: event.clientX, y: event.clientY },
				startWorld: world,
				startViewport: { x: 0, y: 0 },
			}
			setBrushPoints([world])
			return
		}

		event.preventDefault()
		svgRef.current?.setPointerCapture(event.pointerId)
		interactionRef.current = {
			mode: 'create',
			pointerId: event.pointerId,
			startClient: { x: event.clientX, y: event.clientY },
			startWorld: world,
			startViewport: { x: 0, y: 0 },
		}
		setCreation({
			id: randomId(),
			type: tool as 'rectangle' | 'ellipse' | 'line',
			x: world.x,
			y: world.y,
			w: 0,
			h: 0,
			color: tool === 'line' ? CANDY_LAYOUT.linePreset : CANDY_COLORS.blue,
		})
	}

	const onCanvasPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
		const interaction = interactionRef.current
		if (!interaction || interaction.pointerId !== event.pointerId) return

		if (interaction.mode === 'pan') {
			setViewport((current) => ({
				...current,
				x: interaction.startViewport.x + event.clientX - interaction.startClient.x,
				y: interaction.startViewport.y + event.clientY - interaction.startClient.y,
			}))
			return
		}

		const world = clientToWorld(event.clientX, event.clientY)

		if (interaction.mode === 'connection') {
			connection.move(world)
			return
		}

		if (interaction.mode === 'marquee') {
			setMarquee(normalizeRect(interaction.startWorld, world))
			return
		}

		if (interaction.mode === 'brush') {
			setBrushPoints((current) => {
				if (!current?.length) return [world]
				const last = current[current.length - 1]
				if (Math.hypot(world.x - last.x, world.y - last.y) * viewport.zoom < 1.5) return current
				return [...current, world]
			})
			return
		}

		if (interaction.mode === 'create' && creation) {
			if (creation.type === 'line') {
				setCreation({
					...creation,
					w: world.x - interaction.startWorld.x,
					h: world.y - interaction.startWorld.y,
				})
			} else {
				const x = Math.min(interaction.startWorld.x, world.x)
				const y = Math.min(interaction.startWorld.y, world.y)
				setCreation({
					...creation,
					x,
					y,
					w: Math.abs(world.x - interaction.startWorld.x),
					h: Math.abs(world.y - interaction.startWorld.y),
				})
			}
			return
		}

		if (interaction.mode === 'shape' && interaction.shape && interaction.previewToken) {
			const original = interaction.shape
			const group = interaction.group ?? [original]
			const moving = new Set(group.map((item) => item.id))
			const snapped = snapMove(
				original,
				{
					x: original.x + world.x - interaction.startWorld.x,
					y: original.y + world.y - interaction.startWorld.y,
				},
				visibleShapes.filter((candidate) => !moving.has(candidate.id)),
				viewport.zoom,
			)
			const deltaX = snapped.x - original.x
			const deltaY = snapped.y - original.y
			const token = interaction.previewToken
			setDragPreviews((current) => {
				const next = new Map(current)
				for (const shape of group)
					next.set(shape.id, { x: shape.x + deltaX, y: shape.y + deltaY, token })
				return next
			})
			setGuides(snapped.guides)
		}
	}

	const onCanvasPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
		const interaction = interactionRef.current
		if (!interaction || interaction.pointerId !== event.pointerId) return

		if (interaction.mode === 'connection') {
			connection.finish(clientToWorld(event.clientX, event.clientY), event.pointerId)
		}

		if (interaction.mode === 'marquee' && marquee) {
			setSelectedIds(selectInRect(board.shapes, marquee))
			setMarquee(null)
		}

		if (interaction.mode === 'brush' && brushPoints && brushPoints.length >= 2) {
			const xs = brushPoints.map((point) => point.x)
			const ys = brushPoints.map((point) => point.y)
			const minX = Math.min(...xs)
			const minY = Math.min(...ys)
			const w = Math.max(...xs) - minX
			const h = Math.max(...ys) - minY
			const points = brushPoints.map((point) => ({
				x: Math.min(w, Math.max(0, point.x - minX)),
				y: Math.min(h, Math.max(0, point.y - minY)),
			}))
			createShape({
				id: randomId(),
				type: 'path',
				x: minX,
				y: minY,
				w,
				h,
				color: CANDY_COLORS.ink,
				points,
				brush: brushStyle,
				strokeWidth: brushWidth,
			})
		}
		setBrushPoints(null)

		if (interaction.mode === 'create' && creation) {
			if (Math.abs(creation.w) >= 8 || Math.abs(creation.h) >= 8) {
				const shape =
					creation.type === 'line'
						? creation
						: { ...creation, w: Math.max(8, creation.w), h: Math.max(8, creation.h) }
				createShape(shape)
			}
		}

		if (interaction.mode === 'shape' && interaction.shape) {
			const world = clientToWorld(event.clientX, event.clientY)
			const dx = world.x - interaction.startWorld.x
			const dy = world.y - interaction.startWorld.y
			const moved =
				Math.hypot(
					event.clientX - interaction.startClient.x,
					event.clientY - interaction.startClient.y,
				) > 2
			if (moved) {
				const original = interaction.shape
				const group = interaction.group ?? [original]
				const moving = new Set(group.map((item) => item.id))
				const snapped = snapMove(
					original,
					{ x: original.x + dx, y: original.y + dy },
					visibleShapes.filter((candidate) => !moving.has(candidate.id)),
					viewport.zoom,
				)
				const deltaX = snapped.x - original.x
				const deltaY = snapped.y - original.y
				const token = interaction.previewToken ?? ++dragTokenRef.current
				setDragPreviews((current) => {
					const next = new Map(current)
					for (const shape of group)
						next.set(shape.id, { x: shape.x + deltaX, y: shape.y + deltaY, token })
					return next
				})
				void postOperations(
					group.map((shape) => {
						const rect = { x: shape.x + deltaX, y: shape.y + deltaY, w: shape.w, h: shape.h }
						const frameId =
							shape.frameId && moving.has(shape.frameId)
								? shape.frameId
								: membershipAfterMove(board.shapes, shape.frameId, rect, shape.id)
						const detached = shape.type !== 'frame' && frameId !== (shape.frameId ?? null)
						return {
							type: 'update' as const,
							id: shape.id,
							patch: {
								x: rect.x,
								y: rect.y,
								...(detached ? { frameId } : {}),
							},
						}
					}),
					interaction.revision,
					(current) => canRebaseMoveGroup(current, group),
				).then(() => {
					for (const shape of group) clearDragPreview(shape.id, token)
				})
			} else if (interaction.previewToken) {
				const group = interaction.group ?? [interaction.shape]
				for (const shape of group) clearDragPreview(shape.id, interaction.previewToken)
			}
		}

		setCreation(null)
		setIsPanning(false)
		setGuides([])
		interactionRef.current = null
		if (svgRef.current?.hasPointerCapture(event.pointerId))
			svgRef.current.releasePointerCapture(event.pointerId)
	}

	const captureConnection = (event: React.PointerEvent<SVGGElement>, begin: () => boolean) => {
		if (!begin()) return
		event.preventDefault()
		event.stopPropagation()
		svgRef.current?.setPointerCapture(event.pointerId)
		interactionRef.current = {
			mode: 'connection',
			pointerId: event.pointerId,
			startClient: { x: event.clientX, y: event.clientY },
			startWorld: clientToWorld(event.clientX, event.clientY),
			startViewport: { x: viewport.x, y: viewport.y },
		}
	}

	const beginInlineEdit = (shape: CanvasShape) => {
		if (
			shape.type !== 'frame' &&
			shape.type !== 'html' &&
			shape.type !== 'text' &&
			shape.type !== 'note'
		)
			return
		const field = shape.type === 'frame' || shape.type === 'html' ? 'title' : 'text'
		const value = field === 'title' ? (shape.title ?? '') : (shape.text ?? '')
		setEditing({ id: shape.id, field, value })
	}

	const onShapePointerDown = (event: React.PointerEvent<SVGGElement>, shape: Shape) => {
		if (interactionRef.current) {
			event.stopPropagation()
			return
		}
		if (tool === 'hand' || spacePressed || event.button === 1 || event.button !== 0) return
		event.stopPropagation()

		if (tool === 'connector' && isCanvasShape(shape)) {
			setSelectedIds([])
			captureConnection(event, () =>
				connection.begin(shape, clientToWorld(event.clientX, event.clientY), event.pointerId),
			)
			return
		}

		const additive = event.metaKey || event.ctrlKey || event.shiftKey
		const nextSelection = additive
			? selectedIds.includes(shape.id)
				? selectedIds.filter((id) => id !== shape.id)
				: [...selectedIds, shape.id]
			: selectedIds.includes(shape.id)
				? selectedIds
				: [shape.id]
		setSelectedIds(nextSelection)
		if (tool !== 'select' || isConnector(shape)) return

		const world = clientToWorld(event.clientX, event.clientY)
		if (isCanvasShape(shape)) {
			svgRef.current?.setPointerCapture(event.pointerId)
			const group =
				shape.type === 'frame'
					? [
							shape,
							...board.shapes.filter(
								(candidate): candidate is CanvasShape =>
									candidate.type !== 'connector' && candidate.frameId === shape.id,
							),
						]
					: [shape]
			interactionRef.current = {
				mode: 'shape',
				pointerId: event.pointerId,
				startClient: { x: event.clientX, y: event.clientY },
				startWorld: world,
				startViewport: { x: 0, y: 0 },
				revision: board.revision,
				previewToken: ++dragTokenRef.current,
				shape,
				group,
			}
		}
	}

	const updateSelectedColor = (color: string) => {
		if (!selectedId) return
		void postOperations([{ type: 'update', id: selectedId, patch: { color } }])
	}

	const changeEndpoint = (endpoint: 'from' | 'to', id: string) => {
		if (!selected || !isConnector(selected)) return
		const from = board.shapes.find(
			(shape) => shape.id === (endpoint === 'from' ? id : selected.from),
		)
		const to = board.shapes.find((shape) => shape.id === (endpoint === 'to' ? id : selected.to))
		if (!from || !to || !isCanvasShape(from) || !isCanvasShape(to) || from.id === to.id) return
		const { start, end } = getConnectorAnchors(from, to, {
			fromAnchor: endpoint === 'to' ? selected.fromAnchor : undefined,
			toAnchor: endpoint === 'from' ? selected.toAnchor : undefined,
		})
		void postOperations(
			[
				{
					type: 'update',
					id: selected.id,
					patch: {
						from: from.id,
						to: to.id,
						fromAnchor: getAnchors(from).findIndex(
							(point) => point.x === start.x && point.y === start.y,
						),
						toAnchor: getAnchors(to).findIndex((point) => point.x === end.x && point.y === end.y),
					},
				},
			],
			board.revision,
			(latest) => canRebaseConnector(latest, selected),
		)
	}

	const frameSelection = () => {
		const members = selectedIds.filter((id) => {
			const shape = board.shapes.find((candidate) => candidate.id === id)
			return shape && isCanvasShape(shape) && shape.type !== 'frame'
		})
		const bounds = boundsOf(board.shapes, members)
		if (!bounds) return
		const frameId = randomId()
		const rect = expandRect(bounds, 32)
		setSelectedIds([frameId])
		void postOperations(
			[
				{
					type: 'create',
					shape: { id: frameId, type: 'frame', ...rect, color: CANDY_COLORS.blue, title: 'Frame' },
				},
				...members.map((id) => ({ type: 'update' as const, id, patch: { frameId } })),
			],
			board.revision,
		)
	}

	const visibleShapes = board.shapes.map((shape) => {
		const preview = dragPreviews.get(shape.id)
		return preview && isCanvasShape(shape) ? { ...shape, x: preview.x, y: preview.y } : shape
	})

	const renderShape = (shape: Shape) => {
		if (isConnector(shape)) {
			if (connection.draft?.original?.id === shape.id && connection.preview) return null
			const from = visibleShapes.find((item) => item.id === shape.from)
			const to = visibleShapes.find((item) => item.id === shape.to)
			if (!from || !to || !isCanvasShape(from) || !isCanvasShape(to)) return null
			const { start: a, end: b } = getConnectorAnchors(from, to, shape)
			const active = selectedIds.includes(shape.id)
			return (
				<g
					key={shape.id}
					onPointerDown={(event) => onShapePointerDown(event, shape)}
					className="canvas-shape connector"
					data-shape-id={shape.id}
					style={{
						cursor:
							tool === 'hand' || spacePressed || isPanning
								? isPanning
									? 'grabbing'
									: 'grab'
								: 'pointer',
					}}
				>
					<line
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						stroke="transparent"
						strokeWidth={16}
						vectorEffect="non-scaling-stroke"
					/>
					<line
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						stroke={shape.color}
						strokeWidth={active ? 3 : 2}
						markerEnd="url(#arrow)"
						vectorEffect="non-scaling-stroke"
					/>
				</g>
			)
		}

		const active = selectedIds.includes(shape.id)
		const common = {
			className: 'canvas-shape',
			'data-shape-id': shape.id,
			onDoubleClick: (event: React.MouseEvent<SVGGElement>) => {
				event.stopPropagation()
				beginInlineEdit(shape)
			},
			style: {
				cursor:
					tool === 'hand' || spacePressed || isPanning ? (isPanning ? 'grabbing' : 'grab') : 'move',
			},
			onPointerDown: (event: React.PointerEvent<SVGGElement>) => onShapePointerDown(event, shape),
		}

		if (shape.type === 'rectangle') {
			return (
				<g key={shape.id} {...common}>
					<rect
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						rx={10}
						style={{ fill: candyWash(shape.color) }}
						stroke={shape.color}
						strokeWidth={active ? 3 : 2}
					/>
					{active && (
						<rect
							className="selection"
							x={shape.x - 4}
							y={shape.y - 4}
							width={shape.w + 8}
							height={shape.h + 8}
							rx={12}
						/>
					)}
					{shape.text && (
						<ShapeLabel
							text={shape.text}
							x={shape.x + shape.w / 2}
							y={shape.y + shape.h / 2}
							fill={candyInk(shape.color)}
						/>
					)}
				</g>
			)
		}
		if (shape.type === 'ellipse') {
			return (
				<g key={shape.id} {...common}>
					<ellipse
						cx={shape.x + shape.w / 2}
						cy={shape.y + shape.h / 2}
						rx={shape.w / 2}
						ry={shape.h / 2}
						style={{ fill: candyWash(shape.color) }}
						stroke={shape.color}
						strokeWidth={active ? 3 : 2}
					/>
					{active && (
						<rect
							className="selection"
							x={shape.x - 4}
							y={shape.y - 4}
							width={shape.w + 8}
							height={shape.h + 8}
							rx={12}
						/>
					)}
					{shape.text && (
						<ShapeLabel
							text={shape.text}
							x={shape.x + shape.w / 2}
							y={shape.y + shape.h / 2}
							fill={candyInk(shape.color)}
						/>
					)}
				</g>
			)
		}
		if (shape.type === 'html') {
			return (
				<g key={shape.id} {...common}>
					<rect
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						rx={10}
						style={{
							fill: candyWash(shape.color, 5),
							stroke: active ? shape.color : candyLine(shape.color),
						}}
						strokeWidth={active ? 2 : 1}
						vectorEffect="non-scaling-stroke"
					/>
					<foreignObject
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						pointerEvents={active ? 'auto' : 'none'}
					>
						<div className="html-card">
							{shape.html ? (
								<iframe
									className="html-card-frame"
									title={shape.title ?? 'HTML card'}
									sandbox={HTML_CARD_SANDBOX}
									referrerPolicy="no-referrer"
									srcDoc={htmlCardDocument(shape.html, bootstrapCss, bootstrapJs)}
								/>
							) : (
								<div className="html-card-empty">HTML content is generated through the API</div>
							)}
						</div>
					</foreignObject>
					<CardHeaderPill
						x={shape.x}
						y={shape.y}
						width={Math.min(shape.w, 360)}
						color={shape.color}
						title={shape.title ?? 'HTML card'}
						icon={CodeXml}
						handleId={shape.id}
						onPointerDown={(event) => onShapePointerDown(event, shape)}
						onDoubleClick={(event) => {
							event.stopPropagation()
							beginInlineEdit(shape)
						}}
					/>
					{active && (
						<rect
							className="selection"
							x={shape.x - 4}
							y={shape.y - 4}
							width={shape.w + 8}
							height={shape.h + 8}
							rx={12}
						/>
					)}
				</g>
			)
		}
		if (shape.type === 'image') {
			if (!shape.imageId) return null
			return (
				<g key={shape.id} {...common}>
					<image
						className="canvas-image"
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						href={`/api/images/${encodeURIComponent(shape.imageId)}`}
						preserveAspectRatio="xMidYMid meet"
						style={{
							clipPath: `inset(0 round ${Math.min(10, shape.w / 2)}px / ${Math.min(10, shape.h / 2)}px)`,
						}}
						pointerEvents="none"
					/>
					<rect
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						rx={10}
						fill="transparent"
						stroke={shape.color ?? CANDY_COLORS.ink}
						strokeWidth={active ? 3 : 1}
						vectorEffect="non-scaling-stroke"
					/>
					{active && (
						<rect
							className="selection"
							x={shape.x - 4}
							y={shape.y - 4}
							width={shape.w + 8}
							height={shape.h + 8}
							rx={12}
						/>
					)}
				</g>
			)
		}
		if (shape.type === 'frame') {
			const backgroundShape = shape.backgroundImageId
				? visibleShapes.find(
						(candidate) => candidate.type === 'image' && candidate.id === shape.backgroundImageId,
					)
				: undefined
			const backgroundImageId =
				backgroundShape?.type === 'image' ? backgroundShape.imageId : undefined
			const clipId = `frame-bg-${shape.id}`
			return (
				<g key={shape.id} className="canvas-shape frame" data-shape-id={shape.id}>
					<defs>
						<clipPath id={clipId}>
							<rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={10} />
						</clipPath>
					</defs>
					{backgroundImageId && (
						<image
							className="frame-background-image"
							x={shape.x}
							y={shape.y}
							width={shape.w}
							height={shape.h}
							href={`/api/images/${encodeURIComponent(backgroundImageId)}`}
							preserveAspectRatio={imagePreserveAspectRatio(shape.backgroundFit)}
							clipPath={`url(#${clipId})`}
							pointerEvents="none"
						/>
					)}
					<rect
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						rx={10}
						style={{
							fill: backgroundImageId ? 'none' : candyWash(shape.color, FRAME_FILL_PERCENT),
							stroke: active ? shape.color : candyLine(shape.color),
						}}
						strokeWidth={active ? 2 : 1}
						vectorEffect="non-scaling-stroke"
						pointerEvents="none"
					/>
					{active && (
						<rect
							className="selection"
							x={shape.x - 4}
							y={shape.y - 4}
							width={shape.w + 8}
							height={shape.h + 8}
							rx={12}
							pointerEvents="none"
						/>
					)}
				</g>
			)
		}
		if (shape.type === 'note') {
			return (
				<g key={shape.id} {...common}>
					<StickyNote shape={shape} animate={animatedNotesRef.current.has(shape.id)} />
					{active && (
						<rect
							className="selection"
							x={shape.x - 4}
							y={shape.y - 4}
							width={shape.w + 8}
							height={shape.h + 8}
							rx={6}
						/>
					)}
				</g>
			)
		}
		if (shape.type === 'text') {
			const font = shape.font ?? 'sans'
			return (
				<g key={shape.id} {...common}>
					<rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill="transparent" />
					{active && (
						<rect
							className="selection"
							x={shape.x - 4}
							y={shape.y - 4}
							width={shape.w + 8}
							height={shape.h + 8}
							rx={6}
						/>
					)}
					<foreignObject
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						pointerEvents="none"
					>
						<div
							className="typographic-text"
							style={{
								fontFamily: FONT_STACKS[font],
								fontSize: `${shape.fontSize ?? 32}px`,
								fontWeight: shape.fontWeight ?? 500,
								color: candyInk(shape.color),
							}}
						>
							{shape.text || 'Type something'}
						</div>
					</foreignObject>
				</g>
			)
		}
		if (shape.type === 'path' && shape.points && shape.brush && shape.strokeWidth) {
			return (
				<g key={shape.id} {...common}>
					<BrushStroke
						points={shape.points.map((point) => ({ x: shape.x + point.x, y: shape.y + point.y }))}
						brush={shape.brush}
						strokeWidth={shape.strokeWidth}
						color={shape.color}
					/>
					{active && (
						<rect
							className="selection"
							x={shape.x - 4}
							y={shape.y - 4}
							width={shape.w + 8}
							height={shape.h + 8}
							rx={4}
						/>
					)}
				</g>
			)
		}
		const lineX = Math.min(shape.x, shape.x + shape.w)
		const lineY = Math.min(shape.y, shape.y + shape.h)
		const lineW = Math.abs(shape.w)
		const lineH = Math.abs(shape.h)
		return (
			<g key={shape.id} {...common}>
				<line
					x1={shape.x}
					y1={shape.y}
					x2={shape.x + shape.w}
					y2={shape.y + shape.h}
					stroke="transparent"
					strokeWidth={16}
				/>
				<line
					x1={shape.x}
					y1={shape.y}
					x2={shape.x + shape.w}
					y2={shape.y + shape.h}
					stroke={shape.color}
					strokeWidth={active ? 3 : 2}
				/>
				{active && (
					<rect
						className="selection"
						x={lineX - 4}
						y={lineY - 4}
						width={Math.max(lineW, 8) + 8}
						height={Math.max(lineH, 8) + 8}
						rx={8}
					/>
				)}
			</g>
		)
	}

	const renderFrameLabel = (shape: CanvasShape) => (
		<CardHeaderPill
			key={`label:${shape.id}`}
			x={shape.x}
			y={shape.y}
			width={Math.min(shape.w, 360)}
			color={shape.color}
			title={shape.title ?? 'Frame'}
			icon={Frame}
			handleId={shape.id}
			onPointerDown={(event) => onShapePointerDown(event, shape)}
			onDoubleClick={(event) => {
				event.stopPropagation()
				beginInlineEdit(shape)
			}}
		/>
	)

	return (
		<main
			className={`app ${aiPanelOpen ? 'ai-open' : ''}`}
			style={
				{
					'--control-size': `${CONTROL_SIZE}px`,
					'--icon-size': `${ICON_SIZE}px`,
					'--text-ui': `${TEXT_SIZE}px`,
					'--frame-desktop-inset': `${FRAME_LAYOUT.desktopInset}px`,
					'--frame-mobile-inset': `${FRAME_LAYOUT.mobileInset}px`,
					'--dock-left': dockLayout ? `${dockLayout.left}px` : undefined,
					'--measured-dock-height': dockLayout ? `${dockLayout.height}px` : undefined,
				} as React.CSSProperties
			}
		>
			<input
				ref={imageInputRef}
				className="image-file-input"
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif"
				aria-label="Choose image"
				onChange={(event) => {
					const file = event.currentTarget.files?.[0]
					event.currentTarget.value = ''
					if (file) void uploadImage(file)
				}}
			/>
			<IdentityFrame
				state={{
					canvases,
					activeCanvasId,
					canvasesOpen: canvasPanelOpen,
				}}
				actions={{
					toggleCanvases: toggleCanvasPanel,
					closeCanvases: closeCanvasPanel,
					createCanvas,
					switchCanvas,
					renameCanvas,
					deleteCanvas,
				}}
			/>
			<Toolbar
				state={{
					tool,
					zoom: viewport.zoom,
					canDelete: selectedIds.length > 0,
					canFrame: selectedIds.length > 0,
					brushStyle,
					brushWidth,
					noteColor,
					textFont,
					textSize,
					textWeight,
				}}
				actions={{
					reportLayout: reportDockLayout,
					selectTool: (next) => {
						cancelInteraction()
						if (next !== 'select') emptyState.dismiss()
						if (next === 'image') {
							setTool('select')
							imageInputRef.current?.click()
							return
						}
						setTool(next)
					},
					zoom: (factor) => zoomAt(viewport.zoom * factor),
					resetView: () => setViewport({ x: 0, y: 0, zoom: 1 }),
					fitBoard,
					deleteSelection: deleteSelected,
					frameSelection,
					setBrushStyle,
					setBrushWidth,
					setNoteColor,
					setTextFont,
					setTextSize,
					setTextWeight,
				}}
			/>
			<AssistantFrame
				state={{
					connection: {
						apiConnected,
						wsConnected,
						revision: board.revision,
						objectCount: board.shapes.length,
					},
					open: aiPanelOpen,
					canvasId: activeCanvasId,
					selectedIds,
					initialPrompt: aiPrompt,
				}}
				actions={{
					close: closeAiPanel,
					toggle: () => setAiPanelOpen((open) => !open),
					clearSelection,
					consumeInitialPrompt: consumeAiPrompt,
					createCanvas: createLessonCanvas,
					isGestureActive,
				}}
			/>

			{emptyState.visible && (
				<EmptyState onOpenAssistant={emptyState.openAssistant} onDismiss={emptyState.dismiss} />
			)}

			{tool === 'select' && (
				<SelectionPanel
					shape={selected}
					count={selectedIds.length}
					shapes={board.shapes}
					onClose={() => setSelectedIds([])}
					onPatch={(patch) => {
						if (!selected) return
						void postOperations([{ type: 'update', id: selected.id, patch }])
					}}
					onColor={updateSelectedColor}
					onReconnect={(endpoint, id) => changeEndpoint(endpoint, id)}
				/>
			)}

			{(tool === 'connector' || connection.draft) && (
				<div className="connector-tip" role="status">
					{connection.draft?.pending
						? 'Saving connection…'
						: connection.targetShape && connection.draft?.target
							? 'Release to connect'
							: connection.draft
								? 'Drag near a target to snap'
								: 'Drag between shapes to connect'}
				</div>
			)}

			{notice && <div className="notice">{notice}</div>}

			<svg
				ref={svgRef}
				className="canvas"
				onPointerDown={onCanvasPointerDown}
				onPointerMove={onCanvasPointerMove}
				onPointerUp={onCanvasPointerUp}
				onPointerCancel={(event) => {
					if (interactionRef.current?.pointerId === event.pointerId) cancelInteraction()
				}}
				onWheel={(event) => {
					event.preventDefault()
					zoomAt(viewport.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY)
				}}
				onDoubleClick={(event) => {
					const element = document.elementFromPoint(event.clientX, event.clientY)
					const id =
						element?.closest('[data-card-handle]')?.getAttribute('data-card-handle') ??
						element?.closest('[data-shape-id]')?.getAttribute('data-shape-id')
					const shape = id ? visibleShapes.find((candidate) => candidate.id === id) : undefined
					if (shape && isCanvasShape(shape)) beginInlineEdit(shape)
				}}
				aria-label="Infinite canvas"
				style={{
					cursor: isPanning ? 'grabbing' : tool === 'hand' || spacePressed ? 'grab' : 'default',
				}}
				onLostPointerCapture={(event) => {
					if (interactionRef.current?.pointerId === event.pointerId) cancelInteraction()
				}}
			>
				<defs>
					<marker
						id="arrow"
						viewBox="0 0 10 10"
						refX="9"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
					</marker>
				</defs>
				<BlueprintGrid viewport={viewport} />
				<g
					data-world-layer="true"
					transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
				>
					{visibleShapes.filter((shape) => shape.type === 'frame').map(renderShape)}
					{visibleShapes.filter(isConnector).map(renderShape)}
					{visibleShapes
						.filter((shape) => !isConnector(shape) && shape.type !== 'frame')
						.map(renderShape)}
					{visibleShapes
						.filter((shape): shape is CanvasShape => shape.type === 'frame')
						.map(renderFrameLabel)}
					{creation && renderShape(creation)}
					{brushPoints && (
						<BrushStroke
							points={brushPoints}
							brush={brushStyle}
							strokeWidth={brushWidth}
							color={CANDY_COLORS.ink}
							preview
						/>
					)}
					{marquee && (
						<rect
							className="marquee"
							x={marquee.x}
							y={marquee.y}
							width={marquee.w}
							height={marquee.h}
							vectorEffect="non-scaling-stroke"
						/>
					)}
					{editing &&
						(() => {
							const target = visibleShapes.find((shape) => shape.id === editing.id) as
								| CanvasShape
								| undefined
							if (!target) return null
							const header = target.type === 'frame' || target.type === 'html'
							const box = header
								? {
										x: target.x,
										y: target.y - 40,
										w: Math.max(160, Math.min(target.w, 360)),
										h: 36,
									}
								: target.type === 'note'
									? { x: target.x + 12, y: target.y + 12, w: target.w - 24, h: target.h - 24 }
									: { x: target.x, y: target.y, w: target.w, h: target.h }
							const multiline = target.type === 'text' || target.type === 'note'
							const style =
								target.type === 'text'
									? {
											fontFamily: FONT_STACKS[target.font ?? 'sans'],
											fontSize: `${target.fontSize ?? 32}px`,
											fontWeight: target.fontWeight ?? 500,
										}
									: undefined
							const commit = (value: string) => {
								if (value !== editing.value) {
									void postOperations([
										{ type: 'update', id: editing.id, patch: { [editing.field]: value } },
									])
								}
								setEditing(null)
							}
							return (
								<foreignObject
									x={box.x}
									y={box.y}
									width={box.w}
									height={box.h}
									className="inline-editor"
									onPointerDown={(event) => event.stopPropagation()}
								>
									{multiline ? (
										<textarea
											ref={(node) => node?.focus()}
											defaultValue={editing.value}
											style={style}
											onBlur={(event) => commit(event.target.value)}
											onKeyDown={(event) => {
												event.stopPropagation()
												if (event.key === 'Escape') setEditing(null)
												if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
													commit(event.currentTarget.value)
											}}
										/>
									) : (
										<input
											ref={(node) => node?.focus()}
											defaultValue={editing.value}
											style={style}
											onBlur={(event) => commit(event.target.value)}
											onKeyDown={(event) => {
												event.stopPropagation()
												if (event.key === 'Escape') setEditing(null)
												if (event.key === 'Enter') commit(event.currentTarget.value)
											}}
										/>
									)}
								</foreignObject>
							)
						})()}
					{guides.map((guide) => (
						<line
							key={`${guide.axis}:${guide.value}`}
							className="alignment-guide"
							data-guide-axis={guide.axis}
							x1={guide.axis === 'x' ? guide.value : guide.from}
							y1={guide.axis === 'x' ? guide.from : guide.value}
							x2={guide.axis === 'x' ? guide.value : guide.to}
							y2={guide.axis === 'x' ? guide.to : guide.value}
							vectorEffect="non-scaling-stroke"
						/>
					))}
					<ConnectionOverlay
						draft={connection.draft}
						preview={connection.preview}
						target={connection.targetShape}
						selected={selected && isConnector(selected) ? selected : null}
						shapes={visibleShapes}
						zoom={viewport.zoom}
						controlSize={CONTROL_SIZE}
						onReconnect={(event, connector, endpoint) => {
							if (interactionRef.current || spacePressed || tool === 'hand' || event.button !== 0)
								return
							captureConnection(event, () =>
								connection.reconnect(
									connector,
									endpoint,
									clientToWorld(event.clientX, event.clientY),
									event.pointerId,
								),
							)
						}}
					/>
				</g>
			</svg>
		</main>
	)
}
