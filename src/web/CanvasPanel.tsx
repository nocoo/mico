import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CanvasSummary } from '../shared/types'
import { IconButton } from './IconButton'

interface CanvasPanelProps {
	open: boolean
	canvases: CanvasSummary[]
	activeCanvasId: string
	onClose: () => void
	onCreate: () => void
	onSwitch: (id: string) => void
	onRename: (id: string, name: string) => void
	onDelete: (id: string) => void
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['day', 86_400_000],
	['hour', 3_600_000],
	['minute', 60_000],
]

function formatTime(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	const diff = date.getTime() - Date.now()
	const abs = Math.abs(diff)
	if (abs < 60_000) return 'just now'
	for (const [unit, ms] of RELATIVE_UNITS) {
		if (abs >= ms) {
			return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
				Math.round(diff / ms),
				unit,
			)
		}
	}
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function CanvasPanel({
	open,
	canvases,
	activeCanvasId,
	onClose,
	onCreate,
	onSwitch,
	onRename,
	onDelete,
}: CanvasPanelProps) {
	const renameInputRef = useRef<HTMLInputElement>(null)
	const [renamingId, setRenamingId] = useState<string | null>(null)
	const [renameValue, setRenameValue] = useState('')
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			if (!(target instanceof Element)) return
			if (target.closest('[data-canvas-panel], [data-canvas-toggle]')) return
			onClose()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.stopPropagation()
			onClose()
		}
		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [open, onClose])

	useEffect(() => {
		if (!renamingId) return
		renameInputRef.current?.focus()
	}, [renamingId])

	useEffect(() => {
		if (!confirmDeleteId) return
		const timeout = window.setTimeout(() => setConfirmDeleteId(null), 4000)
		return () => window.clearTimeout(timeout)
	}, [confirmDeleteId])

	if (!open) return null

	const commitRename = (id: string) => {
		const name = renameValue.trim()
		setRenamingId(null)
		if (name && name !== canvases.find((canvas) => canvas.id === id)?.name) onRename(id, name)
	}

	return (
		<section className="canvas-panel floating-panel" aria-label="Canvases" data-canvas-panel="true">
			<header className="canvas-panel-header">
				<div className="canvas-panel-heading">
					<span className="canvas-panel-title">Canvases</span>
					<span className="canvas-panel-count">{canvases.length}</span>
				</div>
				<IconButton
					icon={Plus}
					label="New canvas"
					compact
					tooltipSide="bottom"
					onClick={onCreate}
				/>
			</header>
			<ul className="canvas-list">
				{canvases.map((canvas) => {
					const active = canvas.id === activeCanvasId
					const renaming = renamingId === canvas.id
					const body = (
						<>
							{canvas.preview ? (
								<img className="canvas-preview" src={canvas.preview} alt="" loading="lazy" />
							) : (
								<span className="canvas-preview canvas-preview-empty" aria-hidden="true" />
							)}
							<span className="canvas-copy">
								{renaming ? (
									<input
										className="canvas-name-input"
										aria-label="Canvas name"
										value={renameValue}
										ref={renameInputRef}
										onChange={(event) => setRenameValue(event.target.value)}
										onBlur={() => commitRename(canvas.id)}
										onKeyDown={(event) => {
											event.stopPropagation()
											if (event.key === 'Enter') {
												event.preventDefault()
												commitRename(canvas.id)
											}
											if (event.key === 'Escape') {
												event.preventDefault()
												setRenamingId(null)
											}
										}}
									/>
								) : (
									<span className="canvas-name">{canvas.name}</span>
								)}
								<time className="canvas-time" dateTime={canvas.updatedAt}>
									{formatTime(canvas.updatedAt)}
								</time>
							</span>
						</>
					)
					return (
						<li key={canvas.id} className={`canvas-item ${active ? 'active' : ''}`}>
							{renaming ? (
								<div className="canvas-switch canvas-switch-editing">{body}</div>
							) : (
								<button
									type="button"
									className="canvas-switch"
									aria-label={`Open canvas ${canvas.name}`}
									aria-current={active ? 'true' : undefined}
									onClick={() => onSwitch(canvas.id)}
								>
									{body}
								</button>
							)}
							<div className="canvas-actions">
								<IconButton
									icon={Pencil}
									label={`Rename ${canvas.name}`}
									compact
									tooltipSide="bottom"
									onClick={() => {
										setConfirmDeleteId(null)
										setRenamingId(canvas.id)
										setRenameValue(canvas.name)
									}}
								/>
								<IconButton
									icon={Trash2}
									label={
										confirmDeleteId === canvas.id
											? `Confirm delete ${canvas.name}`
											: `Delete ${canvas.name}`
									}
									compact
									tooltipSide="bottom"
									className={confirmDeleteId === canvas.id ? 'danger' : ''}
									disabled={canvases.length <= 1}
									onClick={() => {
										if (confirmDeleteId === canvas.id) {
											setConfirmDeleteId(null)
											onDelete(canvas.id)
											return
										}
										setConfirmDeleteId(canvas.id)
									}}
								/>
							</div>
							{active && (
								<span className="canvas-active">
									<Check size={16} strokeWidth={2} aria-hidden="true" />
								</span>
							)}
						</li>
					)
				})}
			</ul>
		</section>
	)
}
