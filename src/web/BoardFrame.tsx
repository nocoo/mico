import {
	ArrowUpRight,
	Circle,
	Hand,
	Maximize,
	Minus,
	MousePointer2,
	Plus,
	Slash,
	Square,
	Trash2,
	Type,
} from 'lucide-react'
import { type ReactNode, useLayoutEffect, useRef } from 'react'
import type { Tool } from './design'
import { IconButton } from './IconButton'

const tools = [
	{ id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
	{ id: 'hand', label: 'Pan', shortcut: 'H', icon: Hand },
	{ id: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: Square },
	{ id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: Circle },
	{ id: 'text', label: 'Text', shortcut: 'T', icon: Type },
	{ id: 'line', label: 'Line', shortcut: 'L', icon: Slash },
	{ id: 'connector', label: 'Connector', shortcut: 'C', icon: ArrowUpRight },
] as const

interface BoardFrameProps {
	tool: Tool
	onToolChange: (tool: Tool) => void
	zoom: number
	onZoom: (factor: number) => void
	onReset: () => void
	onFit: () => void
	onDelete: () => void
	canDelete: boolean
	apiConnected: boolean
	wsConnected: boolean
	revision: number
	objectCount: number
	properties?: ReactNode
}

export function BoardFrame({
	tool,
	onToolChange,
	zoom,
	onZoom,
	onReset,
	onFit,
	onDelete,
	canDelete,
	apiConnected,
	wsConnected,
	revision,
	objectCount,
	properties,
}: BoardFrameProps) {
	const dockRef = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		const dock = dockRef.current
		const root = dock?.closest<HTMLElement>('.app')
		if (!dock || !root) return
		const measure = () => {
			const rect = dock.getBoundingClientRect()
			root.style.setProperty('--measured-dock-height', `${rect.height}px`)
			root.style.setProperty(
				'--dock-left',
				`${Math.round((window.innerWidth - rect.width) / 2 / 4) * 4}px`,
			)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(dock)
		window.addEventListener('resize', measure)
		return () => {
			observer.disconnect()
			window.removeEventListener('resize', measure)
			root.style.removeProperty('--measured-dock-height')
			root.style.removeProperty('--dock-left')
		}
	}, [])

	const status = !apiConnected ? 'offline' : wsConnected ? 'live' : 'api'
	const statusLabel = !apiConnected ? 'Offline' : wsConnected ? 'Live' : 'Reconnecting'

	return (
		<>
			<header className="topbar">
				<div className="identity-panel floating-panel">
					<div className="brand">
						<svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path
								d="M3 19V5L12 14L21 5V19"
								stroke="currentColor"
								strokeWidth="2.25"
								strokeLinejoin="round"
							/>
							<path
								d="M3 5H6M18 5H21M10 19H14"
								stroke="currentColor"
								strokeWidth="2.25"
								strokeLinecap="round"
							/>
						</svg>
						<strong>mico</strong>
					</div>
					<span
						className={`status ${status}`}
						role="status"
						aria-label={statusLabel}
						title={`Revision ${revision} · ${objectCount} objects`}
					>
						<span className="status-dot" aria-hidden="true" />
					</span>
				</div>
			</header>

			<div
				className="toolbar floating-panel"
				ref={dockRef}
				role="toolbar"
				aria-label="Canvas tools"
				onKeyDown={(event) => {
					if ((event.target as Element).closest('.selection-properties')) return
					if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
					event.preventDefault()
					const buttons = [
						...event.currentTarget.querySelectorAll<HTMLButtonElement>(
							'.dock-main .icon-button:not(:disabled), .dock-main .zoom-value',
						),
					]
					const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
					const next =
						event.key === 'Home'
							? 0
							: event.key === 'End'
								? buttons.length - 1
								: (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
					buttons[next]?.focus()
				}}
			>
				<div className="dock-main">
					{properties}
					{properties && <span className="panel-divider" />}
					<div className="drawing-tools">
						{tools.map(({ id, label, shortcut, icon }) => (
							<div className="tool-slot" key={id}>
								{(id === 'rectangle' || id === 'line') && <span className="panel-divider" />}
								<IconButton
									icon={icon}
									label={label}
									shortcut={shortcut}
									aria-pressed={tool === id}
									tabIndex={tool === id ? 0 : -1}
									onClick={() => onToolChange(id)}
								/>
							</div>
						))}
						<span className="panel-divider" />
						<IconButton
							icon={Trash2}
							label="Delete selected"
							shortcut="Delete"
							tabIndex={-1}
							disabled={!canDelete}
							onClick={onDelete}
							className="delete-tool"
						/>
					</div>
					<span className="panel-divider dock-divider" />
					<fieldset className="view-controls" aria-label="View controls">
						<div className="zoom-controls">
							<IconButton
								icon={Minus}
								label="Zoom out"
								shortcut="−"
								tabIndex={-1}
								onClick={() => onZoom(1 / 1.2)}
							/>
							<button
								className="zoom-value text-button"
								type="button"
								tabIndex={-1}
								onClick={onReset}
								aria-label="Reset view"
								title="Reset view (0)"
							>
								{Math.round(zoom * 100)}%
							</button>
							<IconButton
								icon={Plus}
								label="Zoom in"
								shortcut="+"
								tabIndex={-1}
								onClick={() => onZoom(1.2)}
							/>
						</div>
						<span className="panel-divider" />
						<IconButton
							icon={Maximize}
							label="Fit board"
							shortcut="F"
							tabIndex={-1}
							onClick={onFit}
						/>
					</fieldset>
				</div>
			</div>
		</>
	)
}
