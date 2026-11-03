import { IconButton as RadixIconButton, Tooltip } from '@radix-ui/themes'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
	icon: LucideIcon
	label: string
	shortcut?: string
	tooltipSide?: 'top' | 'bottom'
	active?: boolean
	compact?: boolean
}

export function IconButton({
	icon: Icon,
	label,
	shortcut,
	tooltipSide = 'top',
	className = '',
	children,
	active,
	compact,
	...props
}: IconButtonProps) {
	return (
		<Tooltip
			side={tooltipSide}
			delayDuration={200}
			content={
				<span className="tooltip-content">
					{label}
					{shortcut && <kbd>{shortcut}</kbd>}
				</span>
			}
		>
			<RadixIconButton
				{...props}
				type="button"
				aria-label={label}
				variant={active || props['aria-pressed'] ? 'solid' : 'ghost'}
				color={active || props['aria-pressed'] ? undefined : 'gray'}
				size={compact ? '1' : '3'}
				data-compact={compact ? 'true' : undefined}
				className={`icon-button ${className}`}
			>
				<Icon aria-hidden="true" strokeWidth={1.5} />
				{children}
			</RadixIconButton>
		</Tooltip>
	)
}
