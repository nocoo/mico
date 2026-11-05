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
	renderValue?: (option: { value: T; label: string }) => ReactNode
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
	renderValue,
	renderItem,
}: SelectFieldProps<T>) {
	const selectedOption = options.find((option) => option.value === value)
	const selectedValue = selectedOption
		? renderValue
			? renderValue(selectedOption)
			: renderItem
				? renderItem(selectedOption)
				: selectedOption.label
		: null
	return (
		<Select.Root value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
			<Select.Trigger id={id} aria-label={label} className="select-trigger">
				{selectedValue}
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
						{renderItem ? renderItem(option) : renderValue ? renderValue(option) : option.label}
					</Select.Item>
				))}
			</Select.Content>
		</Select.Root>
	)
}
