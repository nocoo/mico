import { Check, RotateCcw, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CONTROL_TIERS, TEXT_TIERS } from './design'
import { IconButton } from './IconButton'
import type { useInterfacePreferences } from './useInterfacePreferences'

export function InterfaceSettings({
	preferences,
	updatePreferences,
	persisted,
}: ReturnType<typeof useInterfacePreferences>) {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLFieldSetElement>(null)

	useEffect(() => {
		if (!open) return
		ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
		const onPointerDown = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', onPointerDown)
		return () => document.removeEventListener('pointerdown', onPointerDown)
	}, [open])

	return (
		<fieldset
			className="view-settings"
			aria-label="Interface preferences"
			ref={ref}
			onKeyDown={(event) => {
				if (event.key === 'Escape' && open) {
					event.stopPropagation()
					setOpen(false)
					ref.current?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus()
				}
			}}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
			}}
		>
			<IconButton
				icon={Settings2}
				label="Interface settings"
				tabIndex={-1}
				aria-expanded={open}
				aria-controls="interface-settings"
				onClick={() => setOpen(!open)}
			/>
			{open && (
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
							{(Object.keys(CONTROL_TIERS) as Array<keyof typeof CONTROL_TIERS>).map((tier) => (
								<button
									type="button"
									key={tier}
									aria-pressed={preferences.controls === tier}
									onClick={() => updatePreferences({ controls: tier })}
								>
									{tier}
								</button>
							))}
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
	)
}
