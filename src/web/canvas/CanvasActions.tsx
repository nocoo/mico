import type React from 'react'
import type { ActionItem } from '../../shared/types'
import { jellyStyle } from './jelly'
import './jelly.css'
import './canvas-actions.css'

export interface CanvasActionsProps {
	color: string
	items: readonly ActionItem[]
	onToggle: (id: string, done: boolean) => void
	disabled?: boolean
	interactive?: boolean
	title?: string
}

const stopActivationKeyPropagation = (event: React.KeyboardEvent<HTMLButtonElement>) => {
	if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

export function CanvasActions({
	color,
	items,
	onToggle,
	disabled = false,
	interactive = true,
	title = '行动项',
}: CanvasActionsProps) {
	return (
		<section className="el-actions canvas-jelly" style={jellyStyle(color)} aria-label={title}>
			<h3>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M5 12.500l4.500 4.500L19 7.500" />
				</svg>
				<span className="el-actions-title" title={title}>
					{title}
				</span>
			</h3>
			{items.length > 0 ? (
				items.map((item) => (
					// biome-ignore lint/a11y/useSemanticElements: The canvas contract requires a native button with aria-checked.
					<button
						key={item.id}
						type="button"
						className={`act${item.done ? ' done' : ''}`}
						role="checkbox"
						aria-checked={item.done}
						disabled={disabled}
						data-action-id={item.id}
						onPointerDown={(event) => {
							if (interactive && event.button === 0) event.stopPropagation()
						}}
						onClick={(event) => {
							event.stopPropagation()
							if (interactive && !disabled) onToggle(item.id, !item.done)
						}}
						onDoubleClick={(event) => event.stopPropagation()}
						onKeyDown={stopActivationKeyPropagation}
						onKeyUp={stopActivationKeyPropagation}
					>
						<span className="box" aria-hidden="true">
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M5 12.500l4.500 4.500L19 7.500" />
							</svg>
						</span>
						<span className="act-text">{item.text}</span>
					</button>
				))
			) : (
				<p className="el-actions-empty">暂无行动项</p>
			)}
		</section>
	)
}
