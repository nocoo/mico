import {
	ArrowUpRight,
	Check,
	Circle,
	Hand,
	Maximize,
	Minus,
	MousePointer2,
	Plus,
	RotateCcw,
	Settings2,
	Slash,
	Square,
	Trash2,
	Type,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import manifest from '../../package.json'
import { CONTROL_TIERS, TEXT_TIERS, type Tool } from './design'
import { IconButton } from './IconButton'
import type { useInterfacePreferences } from './useInterfacePreferences'

const tools = [
	{ id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
	{ id: 'hand', label: 'Pan', shortcut: 'H', icon: Hand },
	{ id: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: Square },
	{ id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: Circle },
	{ id: 'text', label: 'Text', shortcut: 'T', icon: Type },
	{ id: 'line', label: 'Line', shortcut: 'L', icon: Slash },
	{ id: 'connector', label: 'Connector', shortcut: 'C', icon: ArrowUpRight },
] as const

interface BoardFrameProps extends ReturnType<typeof useInterfacePreferences> {
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
	preferences,
	updatePreferences,
	persisted,
}: BoardFrameProps) {
	const [settingsOpen, setSettingsOpen] = useState(false)
	const settingsRef = useRef<HTMLFieldSetElement>(null)
	const status = !apiConnected ? 'offline' : wsConnected ? 'live' : 'api'
	const statusLabel = !apiConnected ? 'Offline' : wsConnected ? 'Live' : 'Reconnecting'

	useEffect(() => {
		if (!settingsOpen) return
		settingsRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
		const onPointerDown = (event: PointerEvent) => {
			if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false)
		}
		document.addEventListener('pointerdown', onPointerDown)
		return () => document.removeEventListener('pointerdown', onPointerDown)
	}, [settingsOpen])

	return (
		<>
			<header className="topbar">
				<div className="identity-panel floating-panel">
					<div className="brand">
						<svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
							<path
								d="M6 24V8L16 18L26 8V24"
								stroke="currentColor"
								strokeWidth="3"
								strokeLinejoin="round"
							/>
							<path
								d="M6 8H10M22 8H26M14 24H18"
								stroke="currentColor"
								strokeWidth="3"
								strokeLinecap="round"
							/>
						</svg>
						<strong>mico</strong>
						<span className="version">v{manifest.version}</span>
					</div>
					<span className="panel-divider" />
					<span className="board-name">Local canvas</span>
					<div
						className={`status ${status}`}
						title={`Revision ${revision} · ${objectCount} objects`}
					>
						<span className="status-dot" />
						<span className="status-label">{statusLabel}</span>
					</div>
				</div>

				<fieldset className="view-panel floating-panel" aria-label="View controls">
					<div className="zoom-controls">
						<IconButton
							icon={Minus}
							label="Zoom out"
							shortcut="−"
							tooltipSide="bottom"
							onClick={() => onZoom(1 / 1.2)}
						/>
						<button
							className="zoom-value text-button"
							type="button"
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
							tooltipSide="bottom"
							onClick={() => onZoom(1.2)}
						/>
					</div>
					<span className="panel-divider" />
					<IconButton
						icon={Maximize}
						label="Fit board"
						shortcut="F"
						tooltipSide="bottom"
						onClick={onFit}
					/>
					<fieldset
						className="view-settings"
						aria-label="Interface preferences"
						ref={settingsRef}
						onKeyDown={(event) => {
							if (event.key === 'Escape' && settingsOpen) {
								event.stopPropagation()
								setSettingsOpen(false)
								settingsRef.current?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus()
							}
						}}
						onBlur={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget)) setSettingsOpen(false)
						}}
					>
						<IconButton
							icon={Settings2}
							label="Interface settings"
							tooltipSide="bottom"
							aria-expanded={settingsOpen}
							aria-controls="interface-settings"
							onClick={() => setSettingsOpen(!settingsOpen)}
						/>
						{settingsOpen && (
							<section
								className="settings-panel floating-panel"
								id="interface-settings"
								aria-label="Interface settings"
							>
								<div className="panel-heading">
									<strong>Interface</strong>
									<span>Fixed scales</span>
								</div>
								<fieldset className="settings-field">
									<legend>Control size</legend>
									<div className="segmented-control">
										{(Object.keys(CONTROL_TIERS) as Array<keyof typeof CONTROL_TIERS>).map(
											(tier) => (
												<button
													type="button"
													key={tier}
													aria-pressed={preferences.controls === tier}
													onClick={() => updatePreferences({ controls: tier })}
												>
													{tier}
												</button>
											),
										)}
									</div>
								</fieldset>
								<fieldset className="settings-field">
									<legend>Text size</legend>
									<div className="segmented-control">
										{(Object.keys(TEXT_TIERS) as Array<keyof typeof TEXT_TIERS>).map((tier) => (
											<button
												type="button"
												key={tier}
												aria-pressed={preferences.text === tier}
												onClick={() => updatePreferences({ text: tier })}
											>
												{tier}
											</button>
										))}
									</div>
								</fieldset>
								<button
									className="settings-reset text-button"
									type="button"
									onClick={() => updatePreferences({ controls: 'standard', text: 'standard' })}
								>
									<RotateCcw aria-hidden="true" />
									Reset interface
								</button>
								<p className="settings-note">
									<Check aria-hidden="true" />
									{persisted ? 'Saved on this device' : 'This session only · storage unavailable'}
								</p>
							</section>
						)}
					</fieldset>
				</fieldset>
			</header>

			<div
				className="toolbar floating-panel"
				role="toolbar"
				aria-label="Canvas tools"
				onKeyDown={(event) => {
					if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
					event.preventDefault()
					const buttons = [
						...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
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
		</>
	)
}
