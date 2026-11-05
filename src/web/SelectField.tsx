import { Select } from '@radix-ui/themes'
import type { ReactNode } from 'react'
import { FONT_STACKS } from './design'

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
	const previewItem = (option: { value: T; label: string }) => {
		if (label === 'Font family') {
			return (
				<span
					style={{
						fontFamily: FONT_STACKS[option.value as keyof typeof FONT_STACKS],
						fontSize: 16,
					}}
				>
					{option.label}
				</span>
			)
		}
		if (label === 'Font size') {
			return <span style={{ fontSize: Number(option.value) }}>{option.label}</span>
		}
		if (label === 'Font weight') {
			return (
				<span style={{ fontSize: 16, fontWeight: Number(option.value) }}>
					{option.label}
				</span>
			)
		}
		return option.label
	}
	return (
		<Select.Root value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
			<Select.Trigger id={id} aria-label={label} className="select-trigger">
				{selectedOption && renderValue ? renderValue(selectedOption) : null}
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
						{renderItem
							? renderItem(option)
							: renderValue
								? renderValue(option)
								: previewItem(option)}
					</Select.Item>
				))}
			</Select.Content>
		</Select.Root>
	)
}
