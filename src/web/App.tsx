import { Frame } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
	Board,
	BrushStyle,
	CanvasShape,
	Connector,
	Operation,
	Point,
	Shape,
} from '../shared/types'
import { getAnchors, getConnectorAnchors } from './anchors'
import { BlueprintGrid } from './BlueprintGrid'
import { BoardFrame } from './BoardFrame'
import { BrushStroke } from './BrushStroke'
import { CardHeaderPill } from './CardHeaderPill'
import { ConnectionOverlay } from './ConnectionOverlay'
import { canRebaseConnector } from './connections'
import {
	BRUSH_STYLES,
	BRUSH_WIDTHS,
	CONTROL_SIZE,
	FONT_OPTIONS,
	FONT_SIZES,
	FONT_STACKS,
	FONT_WEIGHTS,
	ICON_SIZE,
	NOTE_COLORS,
	TEXT_SIZE,
	type Tool,
} from './design'
import { canRebaseMove } from './move'
import { SelectField } from './SelectField'
import { SelectionPanel } from './SelectionPanel'
import {
	boundsOf,
	expandRect,
	intersects,
	normalizeRect,
	type Rect,
	selectInRect,
	shapeBounds,
} from './selection'
import { type AlignmentGuide, snapMove } from './snap'
import { useConnectionGesture } from './useConnectionGesture'
import { fitViewport } from './viewport'
import { WidgetCard } from './WidgetCard'

const WS_URL = new URL('/api/events', window.location.href)
WS_URL.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

const isConnector = (shape: Shape): shape is Connector => shape.type === 'connector'
const isCanvasShape = (shape: Shape): shape is CanvasShape => shape.type !== 'connector'

const randomId = () => crypto.randomUUID()

export default function App() {
	const svgRef = useRef<SVGSVGElement>(null)
	const initialViewFitted = useRef(false)
	const revisionRef = useRef(0)
	const boardRef = useRef<Board>({ revision: 0, shapes: [] })
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
	const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
	const [tool, setTool] = useState<Tool>('select')
	const [selectedIds, setSelectedIds] = useState<string[]>([])
	const [marquee, setMarquee] = useState<Rect | null>(null)
	const [editing, setEditing] = useState<{
		id: string
		field: 'text' | 'title' | 'widgetTitle'
		value: string
	} | null>(null)
	const [noteColor, setNoteColor] = useState('#fde68a')
	const [textFont, setTextFont] = useState<'sans' | 'serif' | 'hand' | 'mono'>('sans')
	const [textSize, setTextSize] = useState(32)
	const [textWeight, setTextWeight] = useState(500)
	const [widgetKind, setWidgetKind] = useState<'todo' | 'kanban' | 'table' | 'timeline'>('todo')
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
	const [brushWidth, setBrushWidth] = useState<(typeof BRUSH_WIDTHS)[number]>(4)
	const [notice, setNotice] = useState('')
	const [spacePressed, setSpacePressed] = useState(false)
	const [isPanning, setIsPanning] = useState(false)

	const selected = board.shapes.find((shape) => shape.id === selectedId) ?? null

	const announce = useCallback((message: string) => {
		setNotice(message)
		window.setTimeout(() => setNotice((current) => (current === message ? '' : current)), 2600)
	}, [])

	const applyBoard = useCallback((next: Board) => {
		if (next.revision < revisionRef.current) return
		revisionRef.current = next.revision
		boardRef.current = next
		setBoard(next)
		if (!initialViewFitted.current) {
			const rect = svgRef.current?.getBoundingClientRect()
			if (rect) {
				setViewport(fitViewport(next.shapes, rect.width, rect.height))
				initialViewFitted.current = true
			}
		}
		setSelectedIds((current) =>
			current.filter((id) => next.shapes.some((shape) => shape.id === id)),
		)
	}, [])

	const postOperations = useCallback(
		(operations: Operation[], expectedRevision?: number, canRebase?: (board: Board) => boolean) => {
			const result = operationQueue.current.then(async () => {
				try {
					if (canRebase && !canRebase(boardRef.current)) {
						announce('Object changed during drag')
						return false
					}
					const revision = canRebase
						? revisionRef.current
						: (expectedRevision ?? revisionRef.current)
					const response = await fetch('/api/operations', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						signal: AbortSignal.timeout(10000),
						body: JSON.stringify({ operations, expectedRevision: revision }),
					})
					if (!response.ok) {
						const current = await fetch('/api/board', { signal: AbortSignal.timeout(10000) })
						if (current.ok) applyBoard((await current.json()) as Board)
						announce(`Operation failed: HTTP ${response.status}`)
						return false
					}
					const next = (await response.json()) as Board
					applyBoard(next)
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
		[announce, applyBoard],
	)

	const connection = useConnectionGesture(board, viewport.zoom, postOperations)

	useEffect(() => {
		let stopped = false

		const fetchBoard = async () => {
			try {
				const response = await fetch('/api/board', { signal: AbortSignal.timeout(10000) })
				if (!response.ok) throw new Error(`HTTP ${response.status}`)
				const next = (await response.json()) as Board
				if (!stopped) {
					applyBoard(next)
					setApiConnected(true)
				}
			} catch {
				if (!stopped) setApiConnected(false)
			}
		}

		fetchBoard()
		const poll = window.setInterval(fetchBoard, 3000)

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
					const next = JSON.parse(event.data) as Board
					applyBoard(next)
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
	}, [announce, applyBoard])

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

	const intersectsWidget = (rect: Rect, ignored: string) =>
		board.shapes.some(
			(candidate) =>
				candidate.type === 'widget' &&
				candidate.id !== ignored &&
				intersects(shapeBounds(candidate), rect),
		)

	const createShape = (shape: CanvasShape) => {
		if (
			shape.type !== 'widget' &&
			shape.type !== 'frame' &&
			intersectsWidget(shapeBounds(shape), shape.id)
		) {
			announce('Rich widgets are isolated; place this object outside the card')
			return
		}
		selectOnly(shape.id)
		void postOperations([{ type: 'create', shape }])
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
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement
			if (event.key === 'Escape') {
				cancelInteraction()
				setTool('select')
				return
			}
			if (target.closest('input, textarea, select, [contenteditable="true"]')) return
			if (event.metaKey || event.ctrlKey || event.altKey) return

			if (event.code === 'Space') {
				event.preventDefault()
				setSpacePressed(true)
			}
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault()
				deleteSelected()
			}
			const keys: Record<string, typeof tool> = {
				v: 'select',
				h: 'hand',
				r: 'rectangle',
				o: 'ellipse',
				t: 'text',
				l: 'line',
				p: 'path',
				n: 'note',
				w: 'widget',
				c: 'connector',
			}
			const nextTool = keys[event.key.toLowerCase()]
			if (nextTool) {
				cancelInteraction()
				setTool(nextTool)
			}
			if (event.key === '+' || event.key === '=') zoomAt(viewport.zoom * 1.2)
			if (event.key === '-') zoomAt(viewport.zoom / 1.2)
			if (event.key === '0') setViewport({ x: 0, y: 0, zoom: 1 })
			if (event.key.toLowerCase() === 'f') fitBoard()
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
	}, [cancelInteraction, deleteSelected, fitBoard, viewport.zoom, zoomAt])

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
				color: '#242424',
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

		if (tool === 'widget') {
			const titles = {
				todo: 'Checklist',
				kanban: 'Delivery board',
				table: 'Registry',
				timeline: 'Roadmap',
			}
			const sample = {
				todo: [
					{ id: randomId(), title: 'Draft outline', done: true },
					{ id: randomId(), title: 'Review with team', done: false },
					{ id: randomId(), title: 'Publish release', done: false },
				],
				kanban: [
					{ id: randomId(), title: 'Discovery', status: 'done' },
					{ id: randomId(), title: 'Prototype', status: 'doing' },
					{ id: randomId(), title: 'Launch', status: 'todo' },
				],
				table: [
					{ id: randomId(), title: 'Kickoff', status: 'done', start: 1, end: 2 },
					{ id: randomId(), title: 'Build', status: 'doing', start: 2, end: 6 },
					{ id: randomId(), title: 'Ship', status: 'todo', start: 6, end: 8 },
				],
				timeline: [
					{ id: randomId(), title: 'Design', start: 0, end: 3 },
					{ id: randomId(), title: 'Build', start: 2, end: 7 },
					{ id: randomId(), title: 'Launch', start: 7, end: 9 },
				],
			}[widgetKind]
			createShape({
				id: randomId(),
				type: 'widget',
				x: world.x - 260,
				y: world.y - 190,
				w: 520,
				h: 380,
				color: '#5b5fc7',
				widget: widgetKind,
				widgetTitle: titles[widgetKind],
				items: sample,
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
			color: tool === 'line' ? '#616161' : '#5b5fc7',
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
				color: '#242424',
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
				const blocked = group.some(
					(shape) =>
						shape.type !== 'widget' &&
						shape.type !== 'frame' &&
						intersectsWidget(
							{ x: shape.x + deltaX, y: shape.y + deltaY, w: shape.w, h: shape.h },
							shape.id,
						),
				)
				if (blocked) {
					announce('Rich widgets are isolated; drop outside the card')
					setDragPreviews(new Map())
					setGuides([])
					setCreation(null)
					setIsPanning(false)
					interactionRef.current = null
					if (svgRef.current?.hasPointerCapture(event.pointerId)) {
						svgRef.current.releasePointerCapture(event.pointerId)
					}
					return
				}
				const token = interaction.previewToken ?? ++dragTokenRef.current
				setDragPreviews((current) => {
					const next = new Map(current)
					for (const shape of group)
						next.set(shape.id, { x: shape.x + deltaX, y: shape.y + deltaY, token })
					return next
				})
				void postOperations(
					group.map((shape) => {
						const frame = shape.frameId
							? board.shapes.find(
									(candidate): candidate is CanvasShape =>
										candidate.id === shape.frameId && candidate.type !== 'connector',
								)
							: undefined
						const detached =
							frame &&
							!intersects(
								{ x: shape.x + deltaX, y: shape.y + deltaY, w: shape.w, h: shape.h },
								shapeBounds(frame),
							)
						return {
							type: 'update' as const,
							id: shape.id,
							patch: {
								x: shape.x + deltaX,
								y: shape.y + deltaY,
								...(detached ? { frameId: null } : {}),
							},
						}
					}),
					interaction.revision,
					(current) => group.every((shape) => canRebaseMove(current, shape)),
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
			shape.type !== 'widget' &&
			shape.type !== 'text' &&
			shape.type !== 'note'
		)
			return
		const field =
			shape.type === 'frame' ? 'title' : shape.type === 'widget' ? 'widgetTitle' : 'text'
		const value =
			field === 'title'
				? (shape.title ?? '')
				: field === 'widgetTitle'
					? (shape.widgetTitle ?? '')
					: (shape.text ?? '')
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
					shape: { id: frameId, type: 'frame', ...rect, color: '#5b5fc7', title: 'Frame' },
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
				if (
					shape.type !== 'frame' &&
					shape.type !== 'widget' &&
					shape.type !== 'text' &&
					shape.type !== 'note'
				)
					return
				const field =
					shape.type === 'frame' ? 'title' : shape.type === 'widget' ? 'widgetTitle' : 'text'
				const value =
					field === 'title'
						? (shape.title ?? '')
						: field === 'widgetTitle'
							? (shape.widgetTitle ?? '')
							: (shape.text ?? '')
				setEditing({ id: shape.id, field, value })
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
						fill="var(--surface)"
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
						<text
							x={shape.x + shape.w / 2}
							y={shape.y + shape.h / 2}
							fill="#172033"
							textAnchor="middle"
							dominantBaseline="middle"
						>
							{shape.text}
						</text>
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
						fill="var(--surface)"
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
						<text
							x={shape.x + shape.w / 2}
							y={shape.y + shape.h / 2}
							fill="#172033"
							textAnchor="middle"
							dominantBaseline="middle"
						>
							{shape.text}
						</text>
					)}
				</g>
			)
		}
		if (shape.type === 'widget') {
			return (
				<g key={shape.id} {...common}>
					<rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill="transparent" />
					<WidgetCard shape={shape} />
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
			return (
				<g key={shape.id} {...common}>
					<rect
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						rx={10}
						fill="#fbfcff"
						stroke={active ? shape.color : 'var(--border)'}
						strokeWidth={active ? 2 : 1}
						vectorEffect="non-scaling-stroke"
					/>
					<CardHeaderPill
						x={shape.x}
						y={shape.y}
						width={Math.min(shape.w, 360)}
						color={shape.color}
						title={shape.title ?? 'Frame'}
						icon={Frame}
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
		if (shape.type === 'note') {
			return (
				<g key={shape.id} {...common}>
					<rect
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						rx={4}
						fill={shape.color}
						className="sticky-note"
					/>
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
						x={shape.x + 12}
						y={shape.y + 12}
						width={shape.w - 24}
						height={shape.h - 24}
						pointerEvents="none"
					>
						<div className="sticky-text">{shape.text || ''}</div>
					</foreignObject>
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
								color: shape.color,
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

	const toolOptions =
		tool === 'path' ? (
			<fieldset className="brush-options" aria-label="Brush options">
				<div className="segmented-control brush-styles">
					{BRUSH_STYLES.map(({ id, label }) => (
						<button
							type="button"
							key={id}
							aria-pressed={brushStyle === id}
							aria-label={`Brush style ${label}`}
							onClick={() => setBrushStyle(id)}
						>
							{label}
						</button>
					))}
				</div>
				<div className="segmented-control brush-widths">
					{BRUSH_WIDTHS.map((width) => (
						<button
							type="button"
							key={width}
							aria-pressed={brushWidth === width}
							aria-label={`Brush width ${width}px`}
							onClick={() => setBrushWidth(width)}
						>
							{width}
						</button>
					))}
				</div>
			</fieldset>
		) : tool === 'note' ? (
			<fieldset className="brush-options" aria-label="Sticky colors">
				<div className="segmented-control note-colors">
					{NOTE_COLORS.map(({ value, label }) => (
						<button
							type="button"
							key={value}
							aria-pressed={noteColor === value}
							aria-label={`${label} sticky`}
							style={{ background: value }}
							onClick={() => setNoteColor(value)}
						/>
					))}
				</div>
			</fieldset>
		) : tool === 'widget' ? (
			<fieldset className="brush-options" aria-label="Widget kind">
				<div className="segmented-control">
					{(['todo', 'kanban', 'table', 'timeline'] as const).map((kind) => (
						<button
							type="button"
							key={kind}
							aria-pressed={widgetKind === kind}
							onClick={() => setWidgetKind(kind)}
						>
							{kind}
						</button>
					))}
				</div>
			</fieldset>
		) : tool === 'text' ? (
			<fieldset className="brush-options text-options" aria-label="Text options">
				<SelectField
					label="Font family"
					value={textFont}
					options={FONT_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
					onChange={setTextFont}
				/>
				<SelectField
					label="Font size"
					value={String(textSize)}
					options={FONT_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
					onChange={(size) => setTextSize(Number(size))}
				/>
				<SelectField
					label="Font weight"
					value={String(textWeight)}
					options={FONT_WEIGHTS.map((weight) => ({ value: String(weight), label: String(weight) }))}
					onChange={(weight) => setTextWeight(Number(weight))}
				/>
			</fieldset>
		) : null

	return (
		<main
			className="app"
			style={
				{
					'--control-size': `${CONTROL_SIZE}px`,
					'--icon-size': `${ICON_SIZE}px`,
					'--text-ui': `${TEXT_SIZE}px`,
				} as React.CSSProperties
			}
		>
			<BoardFrame
				tool={tool}
				onToolChange={(next) => {
					cancelInteraction()
					setTool(next)
				}}
				zoom={viewport.zoom}
				onZoom={(factor) => zoomAt(viewport.zoom * factor)}
				onReset={() => setViewport({ x: 0, y: 0, zoom: 1 })}
				onFit={fitBoard}
				onDelete={deleteSelected}
				canDelete={selectedIds.length > 0}
				apiConnected={apiConnected}
				wsConnected={wsConnected}
				revision={board.revision}
				objectCount={board.shapes.length}
				onFrame={frameSelection}
				canFrame={selectedIds.length > 0}
				toolOptions={toolOptions}
			/>

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
					const id = element?.closest('[data-shape-id]')?.getAttribute('data-shape-id')
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
					{editing &&
						(() => {
							const target = visibleShapes.find((shape) => shape.id === editing.id) as
								| CanvasShape
								| undefined
							if (!target) return null
							const frame = target.type === 'frame' || target.type === 'widget'
							const box = frame
								? { x: target.x, y: target.y - 48, w: Math.min(target.w, 360), h: 36 }
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
					{visibleShapes.filter(isConnector).map(renderShape)}
					{visibleShapes.filter((shape) => shape.type === 'frame').map(renderShape)}
					{visibleShapes
						.filter((shape) => !isConnector(shape) && shape.type !== 'frame')
						.map(renderShape)}
					{creation && renderShape(creation)}
					{brushPoints && (
						<BrushStroke
							points={brushPoints}
							brush={brushStyle}
							strokeWidth={brushWidth}
							color="#242424"
							preview
						/>
					)}
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
