import { Popover } from '@radix-ui/themes'
import { ExternalLink, Presentation, SlidersHorizontal, UserPlus, X } from 'lucide-react'
import '../debug/debug.css'
import './local.css'

export type LocalModeOption = 'local' | 'presenter' | 'guest'

export interface LocalModeMenuProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	mode: LocalModeOption
	busy: boolean
	error: string
	otherPresenter: boolean
	selfRequested: boolean
	memberCount: number
	onSelectMode: (mode: LocalModeOption) => void
	onRequestPresenter?: (requested: boolean) => void
	onOpenWindow: (role: 'presenter' | 'guest') => void
}

const MODE_LABELS: Record<LocalModeOption, string> = {
	local: 'Local',
	presenter: 'Presenter',
	guest: 'Guest',
}

const MODE_DESCRIPTIONS: Record<LocalModeOption, string> = {
	local: 'All local features and AI are unlocked.',
	presenter: 'Demo presenter: AI enabled; manage requests and transfers.',
	guest: 'Demo guest: AI is hidden; manual drawing and requests stay available.',
}

export function LocalModeMenu({
	open,
	onOpenChange,
	mode,
	busy,
	error,
	otherPresenter,
	selfRequested,
	memberCount,
	onSelectMode,
	onRequestPresenter,
	onOpenWindow,
}: LocalModeMenuProps) {
	return (
		<Popover.Root open={open} onOpenChange={onOpenChange}>
			<Popover.Trigger>
				<button
					type="button"
					className="local-mode-trigger frame-identity"
					data-mode={mode}
					aria-label="Local mode"
					aria-expanded={open}
					aria-controls="local-mode-panel"
					data-local-mode-toggle="true"
					title={`Local mode: ${MODE_LABELS[mode]}`}
				>
					<SlidersHorizontal aria-hidden="true" />
					<span>{MODE_LABELS[mode]}</span>
				</button>
			</Popover.Trigger>
			<Popover.Content
				id="local-mode-panel"
				className="debug-panel frame-identity identity-surface local-mode-panel"
				aria-label="Local mode"
				data-local-mode-panel="true"
				side="bottom"
				align="start"
				sideOffset={8}
				collisionPadding={14}
			>
				<header className="debug-panel-header">
					<span className="debug-panel-title">Local mode</span>
					<Popover.Close>
						<button type="button" className="debug-close" aria-label="Close local mode">
							<X aria-hidden="true" />
						</button>
					</Popover.Close>
				</header>
				<div className="debug-panel-content local-mode-content">
					<fieldset className="local-mode-segments" aria-label="Switch mode">
						{(['local', 'presenter', 'guest'] as const).map((option) => (
							<button
								key={option}
								type="button"
								className="local-mode-segment"
								aria-pressed={mode === option}
								disabled={busy}
								onClick={() => onSelectMode(option)}
							>
								{MODE_LABELS[option]}
							</button>
						))}
					</fieldset>
					<p className="local-mode-description">{MODE_DESCRIPTIONS[mode]}</p>
					{error && (
						<p className="demo-error" role="alert">
							{error}
						</p>
					)}
					{mode === 'guest' && otherPresenter && onRequestPresenter && (
						<button
							type="button"
							className="local-mode-action local-mode-action--accent"
							disabled={busy}
							onClick={() => onRequestPresenter(!selfRequested)}
						>
							{selfRequested ? 'Cancel presenter request' : 'Request presenter'}
						</button>
					)}
					<section className="local-mode-windows" aria-label="Open test windows">
						<div className="local-mode-section-head">
							<span>Open new window</span>
							{memberCount > 0 && <span className="local-mode-online">{memberCount} online</span>}
						</div>
						<button
							type="button"
							className="local-mode-action"
							onClick={() => onOpenWindow('guest')}
						>
							<UserPlus aria-hidden="true" />
							<span>Open Guest window</span>
							<ExternalLink className="local-mode-ext" aria-hidden="true" />
						</button>
						<button
							type="button"
							className="local-mode-action"
							onClick={() => onOpenWindow('presenter')}
						>
							<Presentation aria-hidden="true" />
							<span>Open Presenter window</span>
							<ExternalLink className="local-mode-ext" aria-hidden="true" />
						</button>
					</section>
				</div>
			</Popover.Content>
		</Popover.Root>
	)
}
