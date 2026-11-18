import { Check, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { IconButton } from '../../IconButton'
import { useI18n } from '../../i18n'
import type { IdentityActions, IdentityState } from '../contracts'
import { DebugPanel, type DebugPanelProps } from '../debug/DebugPanel'
import { shouldShowDebug } from '../debug/debugViewModel'
import { DemoPanel, type DemoPanelProps } from '../demo/DemoPanel'
import {
	LiveModeFrame,
	type LiveTopbarFollow,
	type LiveTopbarModel,
	type LiveTopbarRemote,
} from '../live/LiveModeFrame'
import { LocalModeMenu, type LocalModeMenuProps } from '../local/LocalModeMenu'
import type { MeetingFrameProps } from '../meeting/viewmodel'
import { formatCanvasTime } from './identityViewModel'
import { useIdentityViewModel } from './useIdentityViewModel'
import './identity.css'

export interface IdentityFrameProps {
	state: IdentityState
	actions: IdentityActions
	debug: DebugPanelProps
	demo?: DemoPanelProps
	localMode?: LocalModeMenuProps
	meeting: MeetingFrameProps
	live?: LiveTopbarModel | null
	liveFollow?: LiveTopbarFollow | null
	remoteLive?: LiveTopbarRemote | null
}

export function IdentityFrame({
	state,
	actions,
	debug,
	demo,
	localMode,
	meeting,
	live,
	liveFollow,
	remoteLive,
}: IdentityFrameProps) {
	const { messages } = useI18n()
	const identity = useIdentityViewModel({ state, actions })
	const showDebug = !demo && shouldShowDebug(debug)
	const showEntry = Boolean(demo) || Boolean(localMode) || showDebug

	return (
		<>
			<header className="topbar frame-identity">
				<div
					className="identity-panel floating-panel"
					data-debug-available={showEntry ? 'true' : undefined}
				>
					<div className="brand">
						<span className="brand-mark">
							<img className="brand-mark-icon" src="/logo.png" alt="" aria-hidden="true" />
						</span>
						<strong>mico</strong>
					</div>
					<IconButton
						icon={Layers}
						label={messages.identity.canvases}
						active={identity.canvasesOpen}
						aria-pressed={identity.canvasesOpen}
						aria-expanded={identity.canvasesOpen}
						aria-controls="canvas-panel"
						onClick={identity.toggleCanvases}
						data-canvas-toggle="true"
					/>
					{demo ? <DemoPanel {...demo} /> : showDebug ? <DebugPanel {...debug} /> : null}
					{localMode && <LocalModeMenu {...localMode} />}
				</div>
				<LiveModeFrame
					model={live ?? null}
					meeting={meeting}
					follow={liveFollow ?? null}
					remoteLive={remoteLive ?? null}
				/>
			</header>
			{identity.mounted && (
				<section
					id="canvas-panel"
					ref={identity.panelRef}
					className="canvas-panel floating-panel frame-identity identity-surface"
					aria-label={messages.identity.canvases}
					aria-hidden={!identity.canvasesOpen || undefined}
					data-state={identity.canvasesOpen ? 'open' : 'closed'}
					data-canvas-panel="true"
					onAnimationEnd={identity.onPanelAnimationEnd}
				>
					<header className="canvas-panel-header">
						<div className="canvas-panel-heading">
							<span className="canvas-panel-title">{messages.identity.canvases}</span>
							<span className="canvas-panel-count">{identity.canvases.length}</span>
						</div>
						<IconButton
							icon={Plus}
							label={messages.identity.newCanvas}
							compact
							tooltipSide="bottom"
							onClick={identity.createCanvas}
						/>
					</header>
					<ul className="canvas-list">
						{identity.canvases.map((canvas) => {
							const active = canvas.id === identity.activeCanvasId
							const renaming = identity.renamingId === canvas.id
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
												value={identity.renameValue}
												ref={identity.renameInputRef}
												onChange={(event) => identity.setRenameValue(event.target.value)}
												onBlur={() => identity.commitRename(canvas.id)}
												onKeyDown={(event) => identity.onRenameKeyDown(event, canvas.id)}
											/>
										) : (
											<span className="canvas-name">{canvas.name}</span>
										)}
										<time className="canvas-time" dateTime={canvas.updatedAt}>
											{formatCanvasTime(canvas.updatedAt)}
										</time>
									</span>
								</>
							)
							return (
								<li
									key={canvas.id}
									className={`canvas-item ${active ? 'active' : ''} ${renaming ? 'editing' : ''}`}
								>
									{renaming ? (
										<div className="canvas-switch canvas-switch-editing">{body}</div>
									) : (
										<button
											type="button"
											className="canvas-switch"
											aria-label={messages.identity.openCanvas(canvas.name)}
											aria-current={active ? 'true' : undefined}
											onClick={() => identity.switchCanvas(canvas.id)}
										>
											{body}
										</button>
									)}
									<div className="canvas-actions">
										<IconButton
											icon={Pencil}
											label={messages.identity.renameCanvas(canvas.name)}
											compact
											tooltipSide="bottom"
											onClick={() => identity.beginRename(canvas.id, canvas.name)}
										/>
										<IconButton
											icon={Trash2}
											label={messages.identity.deleteCanvas(canvas.name)}
											compact
											tooltipSide="bottom"
											className={identity.confirmDeleteId === canvas.id ? 'danger' : ''}
											disabled={!identity.canDeleteCanvas}
											onClick={() => identity.requestDelete(canvas.id)}
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
			)}
		</>
	)
}
