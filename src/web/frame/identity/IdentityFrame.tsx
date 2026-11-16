import { DebugPanel, type DebugPanelProps } from '../debug/DebugPanel'
import { shouldShowDebug } from '../debug/debugViewModel'
import { DemoPanel, type DemoPanelProps } from '../demo/DemoPanel'
import { MeetingFrame } from '../meeting/MeetingFrame'
import './identity.css'

export interface IdentityFrameProps {
	debug: DebugPanelProps
	demo?: DemoPanelProps
}

export function IdentityFrame({ debug, demo }: IdentityFrameProps) {
	const showDebug = !demo && shouldShowDebug(debug)
	const showEntry = Boolean(demo) || showDebug

	return (
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
				{demo ? <DemoPanel {...demo} /> : showDebug ? <DebugPanel {...debug} /> : null}
			</div>
			<MeetingFrame />
		</header>
	)
}
