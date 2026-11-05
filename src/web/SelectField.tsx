import { Select } from '@radix-ui/themes'
import type { ReactNode } from 'react'

interface SelectFieldProps<T extends string> {
	label: string
	value: T
	options: readonly { value: T; label: string }[]
	onChange: (value: T) => void
	disabled?: boolean
	id?: string
	side?: 'top' | 'bottom' | 'left' | 'right'
	renderItem?: (option: { value: T; label: string }) => ReactNode
}

export function SelectField<T extends string>({
	label,
	value,
	options,
	onChange,
	disabled,
	id,
	side = 'bottom',
	renderItem,
}: SelectFieldProps<T>) {
	const selectedOption = options.find((option) => option.value === value)
	return (
		<Select.Root value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
			<Select.Trigger id={id} aria-label={label} className="select-trigger">
				{selectedOption?.label ?? null}
			</Select.Trigger>
			<Select.Content
				position="popper"
				side={side}
				align="start"
				sideOffset={6}
				collisionPadding={8}
				className="select-content"
			>
				{options.map((option) => (
					<Select.Item className="select-item" key={option.value} value={option.value}>
						{renderItem ? renderItem(option) : option.label}
					</Select.Item>
				))}
			</Select.Content>
		</Select.Root>
	)
}
