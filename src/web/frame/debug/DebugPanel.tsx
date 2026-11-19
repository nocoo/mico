import { Popover } from '@radix-ui/themes'
import { Sparkles, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import packageJson from '../../../../package.json' with { type: 'json' }
import type { AuthMode } from '../../../shared/runtime'
import { useI18n } from '../../i18n'
import type { DebugUser } from './debugViewModel'
import { createDebugViewModel } from './debugViewModel'
import './debug.css'

export interface DebugPanelProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	authMode?: AuthMode
	user: DebugUser | null
	avatarUrl: string | null
	ephemeral: boolean
	aiEnabled: boolean
	onSignOut?: () => void
}

function Avatar({
	url,
	fallback,
	className,
}: {
	url: string | null
	fallback: string | null
	className: string
}) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null)

	return (
		<span className={className} aria-hidden="true">
			{url && failedUrl !== url ? (
				<img src={url} alt="" onError={() => setFailedUrl(url)} />
			) : fallback ? (
				<span>{fallback}</span>
			) : (
				<UserRound />
			)}
		</span>
	)
}

export function DebugPanel({
	open,
	onOpenChange,
	user,
	avatarUrl,
	ephemeral,
	aiEnabled,
	onSignOut,
}: DebugPanelProps) {
	const { messages, preference, setPreference } = useI18n()
	const model = createDebugViewModel({
		user,
		avatarUrl,
		ephemeral,
		aiEnabled,
		version: packageJson.version,
		hasSignOut: Boolean(onSignOut),
	})
	const expiresAt = model.user ? new Date(model.user.expiresAt) : null
	const expiryText =
		expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toLocaleString() : null

	return (
		<Popover.Root open={open} onOpenChange={onOpenChange}>
			<Popover.Trigger>
				<button
					type="button"
					className="debug-trigger frame-identity"
					aria-label={messages.identity.debug}
					aria-expanded={open}
					aria-controls="debug-panel"
					data-debug-toggle="true"
					title={messages.identity.debug}
				>
					<Avatar
						url={model.avatarUrl}
						fallback={model.avatarFallback}
						className="debug-avatar debug-avatar-trigger"
					/>
				</button>
			</Popover.Trigger>
			<Popover.Content
				id="debug-panel"
				className="debug-panel frame-identity identity-surface"
				aria-label={messages.identity.debug}
				data-debug-panel="true"
				side="bottom"
				align="start"
				sideOffset={8}
				collisionPadding={14}
			>
				<header className="debug-panel-header">
					<span className="debug-panel-title">{messages.identity.debug}</span>
					<Popover.Close>
						<button type="button" className="debug-close" aria-label={messages.identity.closeDebug}>
							<X aria-hidden="true" />
						</button>
					</Popover.Close>
				</header>
				<div className="debug-panel-content">
					{model.user && (
						<section className="debug-user">
							<Avatar
								url={model.avatarUrl}
								fallback={model.avatarFallback}
								className="debug-avatar debug-avatar-user"
							/>
							<div className="debug-user-copy">
								<strong>{model.user.name}</strong>
								{expiryText && <time dateTime={expiresAt?.toISOString()}>{expiryText}</time>}
							</div>
						</section>
					)}
					{model.preview && (
						<section className="debug-row" aria-label={messages.identity.previewStatus}>
							<strong>{messages.identity.previewStatus}</strong>
							<span>{messages.identity.previewDisappear}</span>
						</section>
					)}
					<section className="debug-row" aria-label={messages.identity.aiAvailable}>
						<span className={`debug-status-icon ${model.aiEnabled ? 'enabled' : 'unavailable'}`}>
							<Sparkles aria-hidden="true" />
						</span>
						<span className="debug-row-copy">
							<strong>
								{model.aiEnabled ? messages.identity.aiAvailable : messages.identity.aiUnavailable}
							</strong>
							{!model.aiEnabled && <span>{messages.identity.aiNotConfigured}</span>}
						</span>
					</section>
					<section className="debug-row" aria-label={messages.common.language}>
						<strong>{messages.common.language}</strong>
						<div className="demo-lang-group">
							{(['auto', 'en', 'zh'] as const).map((pref) => (
								<button
									key={pref}
									type="button"
									className={`demo-member-btn${preference === pref ? ' demo-member-btn--primary' : ''}`}
									onClick={() => setPreference(pref)}
								>
									{pref === 'auto'
										? messages.common.languageAuto
										: pref === 'en'
											? messages.common.languageEn
											: messages.common.languageZh}
								</button>
							))}
						</div>
					</section>
					<section className="debug-version">
						{messages.identity.version} v{model.version}
					</section>
					{model.hasSignOut && (
						<button type="button" className="debug-sign-out" onClick={onSignOut}>
							{messages.identity.signOut}
						</button>
					)}
				</div>
			</Popover.Content>
		</Popover.Root>
	)
}
