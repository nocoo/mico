import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Board, CanvasShape, Connector, Operation, Shape, ShapeType } from '../shared/types'
import {
	type AnchorTarget,
	findClosestAnchor,
	getAnchors,
	getConnectorAnchors,
	type Point,
} from './anchors'
import { canRebaseConnector, canRebaseMove } from './move'
import { getConnectorRoute } from './routing'
import { fitViewport } from './viewport'

const port = import.meta.env.VITE_MICO_PORT || '4318'
const API = `http://127.0.0.1:${port}`
const WS_URL = `ws://127.0.0.1:${port}/api/events`

const isConnector = (shape: Shape): shape is Connector => shape.type === 'connector'
const isCanvasShape = (shape: Shape): shape is CanvasShape => shape.type !== 'connector'

const randomId = () => crypto.randomUUID()

type ConnectorEnd = 'from' | 'to'

interface EndpointDrag {
	connectorId: string
	end: ConnectorEnd
	point: Point
	target: AnchorTarget | null
}

type EndpointPreviews = Partial<Record<ConnectorEnd, { target: AnchorTarget; token: number }>>

interface TextDraft {
	value: string
	revision: number
	conflict: boolean
	saving: boolean
}

function TextField({
	shapeId,
	text,
	revision,
	draft,
	setDrafts,
	onSave,
}: {
	shapeId: string
	text: string
	revision: number
	draft: TextDraft | undefined
	setDrafts: React.Dispatch<React.SetStateAction<Map<string, TextDraft>>>
	onSave: (text: string, revision: number) => Promise<boolean>
}) {
	const baseline = useRef(revision)

	const save = (expectedRevision: number) => {
		if (!draft || draft.saving) return
		const pending = { ...draft, saving: true }
		setDrafts((current) =>
			current.get(shapeId) === draft ? new Map(current).set(shapeId, pending) : current,
		)
		void onSave(draft.value, expectedRevision).then((success) => {
			setDrafts((current) => {
				if (current.get(shapeId) !== pending) return current
				const next = new Map(current)
				if (success) next.delete(shapeId)
				else next.set(shapeId, { ...pending, saving: false, conflict: true })
				return next
			})
		})
	}

	return (
		<>
			<input
				id="shape-text"
				value={draft?.value ?? text}
				disabled={draft?.saving}
				onFocus={() => {
					if (!draft) baseline.current = revision
				}}
				onChange={(event) => {
					const value = event.target.value
					setDrafts((current) =>
						new Map(current).set(shapeId, {
							value,
							revision: current.get(shapeId)?.revision ?? baseline.current,
							conflict: current.get(shapeId)?.conflict ?? false,
							saving: false,
						}),
					)
				}}
				onBlur={() => {
					if (draft && !draft.conflict) save(draft.revision)
				}}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur()
				}}
			/>
			{draft?.conflict && (
				<div className="draft-conflict">
					<span>Draft not saved. Review before replacing board text.</span>
					<button type="button" disabled={draft.saving} onClick={() => save(revision)}>
						Save draft
					</button>
					<button
						type="button"
						disabled={draft.saving}
						onClick={() => {
							setDrafts((current) => {
								const next = new Map(current)
								next.delete(shapeId)
								return next
							})
						}}
					>
						Discard
					</button>
				</div>
			)}
		</>
	)
}

export default function App() {
	const svgRef = useRef<SVGSVGElement>(null)
	const initialViewSet = useRef(false)
	const revisionRef = useRef(0)
	const boardRef = useRef<Board>({ revision: 0, shapes: [] })
	const [textDrafts, setTextDrafts] = useState<Map<string, TextDraft>>(() => new Map())
	const operationQueue = useRef<Promise<void>>(Promise.resolve())
	const interactionRef = useRef<{
		mode: 'pan' | 'shape' | 'create' | 'endpoint'
		pointerId: number
		startClient: { x: number; y: number }
		startWorld: { x: number; y: number }
		startViewport: { x: number; y: number }
		revision?: number
		previewToken?: number
		shape?: CanvasShape
		connector?: Connector
		end?: ConnectorEnd
	} | null>(null)
	const dragTokenRef = useRef(0)

	const [board, setBoard] = useState<Board>({ revision: 0, shapes: [] })
	const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
	const [tool, setTool] = useState<'select' | 'hand' | ShapeType | 'connector'>('select')
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [connectorFrom, setConnectorFrom] = useState<string | null>(null)
	const [creation, setCreation] = useState<CanvasShape | null>(null)
	const [endpointDrag, setEndpointDrag] = useState<EndpointDrag | null>(null)
	const [endpointPreviews, setEndpointPreviews] = useState<Map<string, EndpointPreviews>>(
		() => new Map(),
	)
	const [dragPreviews, setDragPreviews] = useState<
		Map<string, { x: number; y: number; token: number }>
	>(() => new Map())
	const [apiConnected, setApiConnected] = useState(false)
	const [wsConnected, setWsConnected] = useState(false)
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
		if (!initialViewSet.current && svgRef.current) {
			const { width, height } = svgRef.current.getBoundingClientRect()
			if (width > 0 && height > 0) {
				initialViewSet.current = true
				const fitted = fitViewport(next.shapes, width, height)
				if (fitted) setViewport(fitted)
			}
		}
		setBoard(next)
		setSelectedId((current) =>
			current && !next.shapes.some((shape) => shape.id === current) ? null : current,
		)
	}, [])

	const postOperations = useCallback(
		(operations: Operation[], expectedRevision?: number, canRebase?: (board: Board) => boolean) => {
			const result = operationQueue.current.then(async () => {
				try {
					if (canRebase && !canRebase(boardRef.current)) {
						announce('Shape changed during drag')
						return false
					}
					const revision = canRebase
						? revisionRef.current
						: (expectedRevision ?? revisionRef.current)
					const response = await fetch(`${API}/api/operations`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						signal: AbortSignal.timeout(10000),
						body: JSON.stringify({ operations, expectedRevision: revision }),
					})
					if (!response.ok) {
						const current = await fetch(`${API}/api/board`, { signal: AbortSignal.timeout(10000) })
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

	useEffect(() => {
		let stopped = false

		const fetchBoard = async () => {
			try {
				const response = await fetch(`${API}/api/board`)
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
			socket = new WebSocket(WS_URL)
			socket.onopen = () => setWsConnected(true)
			socket.onmessage = (event) => {
				try {
					const next = JSON.parse(event.data) as Board
					applyBoard(next)
					setApiConnected(true)
				} catch {
					announce('Invalid board event')
				}
			}
			socket.onclose = () => {
				setWsConnected(false)
				retry = window.setTimeout(connect, 2000)
			}
			socket.onerror = () => socket?.close()
		}

		connect()

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
			initialViewSet.current = true
			const rect = svgRef.current?.getBoundingClientRect()
			const cx = clientX === undefined ? (rect?.left ?? 0) + (rect?.width ?? 0) / 2 : clientX
			const cy = clientY === undefined ? (rect?.top ?? 0) + (rect?.height ?? 0) / 2 : clientY
			const rx = cx - (rect?.left ?? 0)
			const ry = cy - (rect?.top ?? 0)
			const zoom = Math.min(3, Math.max(0.000001, nextZoom))
			const worldX = (rx - viewport.x) / viewport.zoom
			const worldY = (ry - viewport.y) / viewport.zoom
			setViewport({ x: rx - worldX * zoom, y: ry - worldY * zoom, zoom })
		},
		[viewport],
	)

	const resetViewport = useCallback(() => {
		initialViewSet.current = true
		setViewport({ x: 0, y: 0, zoom: 1 })
	}, [])

	const createShape = (shape: CanvasShape) => {
		setSelectedId(shape.id)
		void postOperations([{ type: 'create', shape }])
	}

	const deleteSelected = useCallback(() => {
		if (!selectedId) return
		void postOperations([{ type: 'delete', id: selectedId }])
	}, [postOperations, selectedId])

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
		if (interaction?.mode === 'endpoint') setEndpointDrag(null)
		if (interaction?.previewToken && interaction.shape) {
			clearDragPreview(interaction.shape.id, interaction.previewToken)
		}
		if (interaction && svgRef.current?.hasPointerCapture(interaction.pointerId)) {
			svgRef.current.releasePointerCapture(interaction.pointerId)
		}
	}, [clearDragPreview])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement
			if (target.matches('input, textarea, select')) return

			if (event.code === 'Space') {
				event.preventDefault()
				setSpacePressed(true)
			}
			if (event.key === 'Escape') {
				setConnectorFrom(null)
				cancelInteraction()
				setTool('select')
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
				c: 'connector',
			}
			const nextTool = keys[event.key.toLowerCase()]
			if (nextTool) {
				setTool(nextTool)
				setConnectorFrom(null)
			}
			if (event.key === '+' || event.key === '=') zoomAt(viewport.zoom * 1.2)
			if (event.key === '-') zoomAt(viewport.zoom / 1.2)
			if (event.key === '0') resetViewport()
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
	}, [cancelInteraction, deleteSelected, resetViewport, viewport.zoom, zoomAt])

	const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
		if (interactionRef.current || (event.button !== 0 && event.button !== 1)) return
		initialViewSet.current = true

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

		if (tool === 'select' || tool === 'connector') {
			setSelectedId(null)
			return
		}

		const world = clientToWorld(event.clientX, event.clientY)
		if (tool === 'text') {
			createShape({
				id: randomId(),
				type: 'text',
				x: world.x - 90,
				y: world.y - 26,
				w: 180,
				h: 52,
				color: '#5b5fc7',
				text: 'Text',
			})
			setTool('select')
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

		if (interaction.mode === 'endpoint' && interaction.connector && interaction.end) {
			const otherId =
				interaction.end === 'from' ? interaction.connector.to : interaction.connector.from
			const target = findClosestAnchor(
				visibleShapes.filter(isCanvasShape),
				world,
				otherId,
				20 / viewport.zoom,
			)
			setEndpointDrag({
				connectorId: interaction.connector.id,
				end: interaction.end,
				point: target?.point ?? world,
				target,
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
			const dx = world.x - interaction.startWorld.x
			const dy = world.y - interaction.startWorld.y
			const original = interaction.shape
			const token = interaction.previewToken
			setDragPreviews((current) =>
				new Map(current).set(original.id, {
					x: original.x + dx,
					y: original.y + dy,
					token,
				}),
			)
		}
	}

	const onCanvasPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
		const interaction = interactionRef.current
		if (!interaction || interaction.pointerId !== event.pointerId) return

		if (interaction.mode === 'create' && creation) {
			if (Math.abs(creation.w) >= 8 || Math.abs(creation.h) >= 8) {
				const shape =
					creation.type === 'line'
						? creation
						: { ...creation, w: Math.max(8, creation.w), h: Math.max(8, creation.h) }
				createShape(shape)
			}
		}

		if (interaction.mode === 'endpoint' && interaction.connector && interaction.end) {
			const world = clientToWorld(event.clientX, event.clientY)
			const otherId =
				interaction.end === 'from' ? interaction.connector.to : interaction.connector.from
			const target = findClosestAnchor(
				visibleShapes.filter(isCanvasShape),
				world,
				otherId,
				20 / viewport.zoom,
			)
			if (target) {
				const connector = interaction.connector
				const end = interaction.end
				const token = ++dragTokenRef.current
				setEndpointPreviews((current) =>
					new Map(current).set(connector.id, {
						...current.get(connector.id),
						[end]: { target, token },
					}),
				)
				const patch =
					end === 'from'
						? { from: target.shapeId, fromAnchor: target.index }
						: { to: target.shapeId, toAnchor: target.index }
				void postOperations(
					[{ type: 'update', id: connector.id, patch }],
					interaction.revision,
					(current) => canRebaseConnector(current, connector),
				).then(() => {
					setEndpointPreviews((current) => {
						const preview = current.get(connector.id)
						if (preview?.[end]?.token !== token) return current
						const next = new Map(current)
						const remaining = { ...preview }
						delete remaining[end]
						if (remaining.from || remaining.to) next.set(connector.id, remaining)
						else next.delete(connector.id)
						return next
					})
				})
			}
			setEndpointDrag(null)
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
				const preview = {
					id: interaction.shape.id,
					x: interaction.shape.x + dx,
					y: interaction.shape.y + dy,
					token: interaction.previewToken ?? ++dragTokenRef.current,
				}
				setDragPreviews((current) => new Map(current).set(preview.id, preview))
				const original = interaction.shape
				void postOperations(
					[
						{
							type: 'update',
							id: preview.id,
							patch: { x: preview.x, y: preview.y },
						},
					],
					interaction.revision,
					(current) => canRebaseMove(current, original),
				).then(() => {
					clearDragPreview(preview.id, preview.token)
				})
			} else if (interaction.previewToken) {
				clearDragPreview(interaction.shape.id, interaction.previewToken)
			}
		}

		setCreation(null)
		setIsPanning(false)
		interactionRef.current = null
		if (svgRef.current?.hasPointerCapture(event.pointerId))
			svgRef.current.releasePointerCapture(event.pointerId)
	}

	const onShapePointerDown = (event: React.PointerEvent<SVGGElement>, shape: Shape) => {
		initialViewSet.current = true
		if (interactionRef.current) {
			event.stopPropagation()
			return
		}
		if (tool === 'hand' || spacePressed || event.button === 1 || event.button !== 0) return
		event.stopPropagation()

		if (tool === 'connector' && isCanvasShape(shape)) {
			if (!connectorFrom) {
				setConnectorFrom(shape.id)
				setSelectedId(shape.id)
				announce('Choose the target object')
			} else if (connectorFrom !== shape.id) {
				const connector: Connector = {
					id: randomId(),
					type: 'connector',
					from: connectorFrom,
					to: shape.id,
					color: '#616161',
				}
				setSelectedId(connector.id)
				setConnectorFrom(null)
				setTool('select')
				void postOperations([{ type: 'create', shape: connector }])
			}
			return
		}

		setSelectedId(shape.id)
		if (tool !== 'select' || isConnector(shape)) return

		const world = clientToWorld(event.clientX, event.clientY)
		if (isCanvasShape(shape)) {
			event.preventDefault()
			svgRef.current?.setPointerCapture(event.pointerId)
			interactionRef.current = {
				mode: 'shape',
				pointerId: event.pointerId,
				startClient: { x: event.clientX, y: event.clientY },
				startWorld: world,
				startViewport: { x: 0, y: 0 },
				revision: board.revision,
				previewToken: ++dragTokenRef.current,
				shape,
			}
		}
	}

	const onEndpointPointerDown = (
		event: React.PointerEvent<SVGCircleElement>,
		connector: Connector,
		end: ConnectorEnd,
		point: Point,
	) => {
		if (tool !== 'select' || spacePressed || event.button !== 0 || interactionRef.current) return
		event.stopPropagation()
		event.preventDefault()
		svgRef.current?.setPointerCapture(event.pointerId)
		interactionRef.current = {
			mode: 'endpoint',
			pointerId: event.pointerId,
			startClient: { x: event.clientX, y: event.clientY },
			startWorld: point,
			startViewport: { x: viewport.x, y: viewport.y },
			revision: board.revision,
			connector,
			end,
		}
		setEndpointDrag({ connectorId: connector.id, end, point, target: null })
	}

	const updateSelectedColor = (color: string) => {
		if (!selectedId) return
		void postOperations([{ type: 'update', id: selectedId, patch: { color } }])
	}

	const visibleShapes = board.shapes.map((shape) => {
		if (isConnector(shape)) {
			const preview = endpointPreviews.get(shape.id)
			if (!preview) return shape
			return {
				...shape,
				...(preview.from
					? { from: preview.from.target.shapeId, fromAnchor: preview.from.target.index }
					: {}),
				...(preview.to ? { to: preview.to.target.shapeId, toAnchor: preview.to.target.index } : {}),
			}
		}
		const preview = dragPreviews.get(shape.id)
		return preview ? { ...shape, x: preview.x, y: preview.y } : shape
	})

	const renderShape = (shape: Shape) => {
		if (isConnector(shape)) {
			const from = visibleShapes.find((item) => item.id === shape.from)
			const to = visibleShapes.find((item) => item.id === shape.to)
			if (!from || !to || !isCanvasShape(from) || !isCanvasShape(to)) return null
			const anchors = getConnectorAnchors(from, to, shape.fromAnchor, shape.toAnchor)
			const a =
				endpointDrag?.connectorId === shape.id && endpointDrag.end === 'from'
					? endpointDrag.point
					: anchors.start
			const b =
				endpointDrag?.connectorId === shape.id && endpointDrag.end === 'to'
					? endpointDrag.point
					: anchors.end
			const drag = endpointDrag?.connectorId === shape.id ? endpointDrag : null
			const targetShape =
				drag?.target && visibleShapes.find((item) => item.id === drag.target?.shapeId)
			const startShape =
				drag?.end === 'from' && targetShape && isCanvasShape(targetShape) ? targetShape : from
			const endShape =
				drag?.end === 'to' && targetShape && isCanvasShape(targetShape) ? targetShape : to
			const fromAnchor = drag?.end === 'from' && drag.target ? drag.target.index : shape.fromAnchor
			const toAnchor = drag?.end === 'to' && drag.target ? drag.target.index : shape.toAnchor
			const route =
				(!drag || drag.target) && (fromAnchor !== undefined || toAnchor !== undefined)
					? getConnectorRoute(startShape, endShape, a, b, fromAnchor, toAnchor)
					: [a, b]
			const path = route
				.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
				.join(' ')
			const active = selectedId === shape.id
			return (
				<g
					key={shape.id}
					onPointerDown={(event) => onShapePointerDown(event, shape)}
					className="canvas-shape connector"
					style={{
						cursor:
							tool === 'hand' || spacePressed || isPanning
								? isPanning
									? 'grabbing'
									: 'grab'
								: 'pointer',
					}}
				>
					<path d={path} fill="none" stroke="transparent" strokeWidth={16} />
					<path
						d={path}
						fill="none"
						stroke={shape.color}
						strokeWidth={active ? 3 : 2}
						markerEnd="url(#arrow)"
					/>
				</g>
			)
		}

		const active = selectedId === shape.id
		const common = {
			className: 'canvas-shape',
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
							x={shape.x - 5}
							y={shape.y - 5}
							width={shape.w + 10}
							height={shape.h + 10}
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
							x={shape.x - 5}
							y={shape.y - 5}
							width={shape.w + 10}
							height={shape.h + 10}
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
		if (shape.type === 'text') {
			return (
				<g key={shape.id} {...common}>
					<rect
						x={shape.x}
						y={shape.y}
						width={shape.w}
						height={shape.h}
						rx={8}
						fill="var(--surface)"
						stroke={active ? shape.color : 'var(--border)'}
						strokeWidth={active ? 2 : 1}
					/>
					{active && (
						<rect
							className="selection"
							x={shape.x - 5}
							y={shape.y - 5}
							width={shape.w + 10}
							height={shape.h + 10}
							rx={12}
						/>
					)}
					<text
						x={shape.x + 14}
						y={shape.y + shape.h / 2}
						fill={shape.color}
						dominantBaseline="middle"
						style={{ fontWeight: 650 }}
					>
						{shape.text || 'Text'}
					</text>
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
						x={lineX - 6}
						y={lineY - 6}
						width={Math.max(lineW, 12) + 12}
						height={Math.max(lineH, 12) + 12}
						rx={8}
					/>
				)}
			</g>
		)
	}

	const visibleSelected = visibleShapes.find((shape) => shape.id === selectedId)
	const selectedConnector =
		visibleSelected && isConnector(visibleSelected) && tool === 'select' ? visibleSelected : null
	const connectorFromShape =
		selectedConnector && visibleShapes.find((shape) => shape.id === selectedConnector.from)
	const connectorToShape =
		selectedConnector && visibleShapes.find((shape) => shape.id === selectedConnector.to)
	const selectedEndpoints =
		selectedConnector &&
		connectorFromShape &&
		connectorToShape &&
		isCanvasShape(connectorFromShape) &&
		isCanvasShape(connectorToShape)
			? getConnectorAnchors(
					connectorFromShape,
					connectorToShape,
					selectedConnector.fromAnchor,
					selectedConnector.toAnchor,
				)
			: null

	const statusText = !apiConnected ? 'Daemon offline' : wsConnected ? 'Live' : 'API connected'
	const statusClass = !apiConnected ? 'offline' : wsConnected ? 'live' : 'api'

	return (
		<main
			className="app"
			style={
				{
					'--grid-x': `${viewport.x}px`,
					'--grid-y': `${viewport.y}px`,
					'--grid-size': `${24 * viewport.zoom}px`,
				} as React.CSSProperties
			}
		>
			<header className="topbar">
				<div className="brand">
					<span className="brand-mark">M</span>
					<strong>Mico</strong>
				</div>
				<div className={`status ${statusClass}`}>
					<span />
					{statusText}
				</div>
				<div className="zoom-controls">
					<button type="button" onClick={() => zoomAt(viewport.zoom / 1.2)} aria-label="Zoom out">
						−
					</button>
					<span>{Math.round(viewport.zoom * 100)}%</span>
					<button type="button" onClick={() => zoomAt(viewport.zoom * 1.2)} aria-label="Zoom in">
						+
					</button>
					<button type="button" onClick={resetViewport} aria-label="Reset view">
						Reset
					</button>
				</div>
			</header>

			<aside className="toolbar" aria-label="Canvas tools">
				{(
					[
						['select', 'V', 'Select'],
						['hand', 'H', 'Pan'],
						['rectangle', 'R', 'Rectangle'],
						['ellipse', 'O', 'Ellipse'],
						['text', 'T', 'Text'],
						['line', 'L', 'Line'],
						['connector', 'C', 'Connector'],
					] as const
				).map(([name, key, label]) => (
					<button
						type="button"
						key={name}
						className={tool === name ? 'active' : ''}
						onClick={() => {
							setTool(name)
							setConnectorFrom(null)
						}}
						title={`${label} (${key})`}
						aria-label={label}
						aria-pressed={tool === name}
					>
						{name === 'hand' ? (
							<svg
								className="tool-icon hand-icon"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M7.8 11V5.8a1.5 1.5 0 0 1 3 0V10" />
								<path d="M10.8 10V4.5a1.5 1.5 0 0 1 3 0V10" />
								<path d="M13.8 10V5.8a1.5 1.5 0 0 1 3 0v5.7" />
								<path d="M16.8 11.5V9a1.5 1.5 0 0 1 3 0v5.2c0 4.1-2.7 6.8-6.8 6.8h-.8a7 7 0 0 1-5.6-2.8l-2.8-3.7a1.7 1.7 0 0 1 2.5-2.3l1.9 1.6V11" />
							</svg>
						) : (
							<span className={`tool-icon ${name}`} />
						)}
						<small>{key}</small>
					</button>
				))}
				<div className="toolbar-rule" />
				<button
					type="button"
					className="delete-tool"
					disabled={!selectedId}
					onClick={deleteSelected}
					title="Delete (Del)"
				>
					<span className="delete-icon">×</span>
					<small>Del</small>
				</button>
			</aside>

			{selected && tool !== 'connector' && (
				<aside className="inspector">
					<div className="inspector-head">
						<strong>
							{isConnector(selected)
								? 'Connector'
								: selected.type[0].toUpperCase() + selected.type.slice(1)}
						</strong>
						<button type="button" onClick={() => setSelectedId(null)} aria-label="Close inspector">
							×
						</button>
					</div>
					{isCanvasShape(selected) && selected.type !== 'line' && (
						<div className="field">
							<label htmlFor="shape-text">Text</label>
							<TextField
								key={selected.id}
								shapeId={selected.id}
								draft={textDrafts.get(selected.id)}
								setDrafts={setTextDrafts}
								text={selected.text ?? ''}
								revision={board.revision}
								onSave={(text, revision) =>
									postOperations([{ type: 'update', id: selected.id, patch: { text } }], revision)
								}
							/>
						</div>
					)}
					<label className="field color-field">
						<span>Color</span>
						<div className="color-row">
							{['#5b5fc7', '#6264a7', '#0f6cbd', '#107c10', '#c42b1c', '#242424'].map((color) => (
								<button
									type="button"
									key={color}
									className={selected.color === color ? 'chosen' : ''}
									style={{ background: color }}
									onClick={() => updateSelectedColor(color)}
									aria-label={`Set color ${color}`}
								/>
							))}
							<input
								type="color"
								value={selected.color}
								onChange={(event) => updateSelectedColor(event.target.value)}
								aria-label="Custom color"
							/>
						</div>
					</label>
				</aside>
			)}

			{connectorFrom && <div className="connector-tip">Source selected · choose target</div>}

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
				<g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
					{visibleShapes.filter(isConnector).map(renderShape)}
					{visibleShapes.filter((shape) => !isConnector(shape)).map(renderShape)}
					{creation && renderShape(creation)}
					{endpointDrag &&
						selectedConnector &&
						visibleShapes
							.filter(isCanvasShape)
							.filter(
								(shape) =>
									shape.id !==
									(endpointDrag.end === 'from' ? selectedConnector.to : selectedConnector.from),
							)
							.flatMap((shape) =>
								getAnchors(shape)
									.map((point, index) => ({ point, index, id: `${shape.id}:${index}` }))
									.map((anchor) => (
										<circle
											key={anchor.id}
											cx={anchor.point.x}
											cy={anchor.point.y}
											r={3.5 / viewport.zoom}
											className={
												endpointDrag.target?.shapeId === shape.id &&
												endpointDrag.target.index === anchor.index
													? 'anchor-candidate active'
													: 'anchor-candidate'
											}
										/>
									)),
							)}
					{selectedConnector &&
						selectedEndpoints &&
						(['from', 'to'] as const).map((end) => {
							const point =
								endpointDrag?.connectorId === selectedConnector.id && endpointDrag.end === end
									? endpointDrag.point
									: end === 'from'
										? selectedEndpoints.start
										: selectedEndpoints.end
							return (
								<g key={end}>
									<circle
										cx={point.x}
										cy={point.y}
										r={13 / viewport.zoom}
										className="endpoint-hit"
										data-endpoint={end}
										onPointerDown={(event) =>
											onEndpointPointerDown(event, selectedConnector, end, point)
										}
									/>
									<circle
										cx={point.x}
										cy={point.y}
										r={5 / viewport.zoom}
										className="endpoint-handle"
									/>
								</g>
							)
						})}
				</g>
			</svg>
		</main>
	)
}
