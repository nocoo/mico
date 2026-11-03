import type { LucideIcon } from 'lucide-react'
import { type ButtonHTMLAttributes, useId } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	icon: LucideIcon
	label: string
	shortcut?: string
	tooltipSide?: 'top' | 'bottom'
}

export function IconButton({
	icon: Icon,
	label,
	shortcut,
	tooltipSide = 'top',
	className = '',
	children,
	...props
}: IconButtonProps) {
	const tooltipId = useId()
	return (
		<button
			{...props}
			type="button"
			className={`icon-button ${className}`}
			aria-label={label}
			aria-describedby={tooltipId}
			data-tooltip-side={tooltipSide}
		>
			<Icon aria-hidden="true" strokeWidth={1.5} />
			{children}
			<span className="control-tooltip" id={tooltipId} role="tooltip">
				{label}
				{shortcut && <kbd>{shortcut}</kbd>}
			</span>
		</button>
	)
}
