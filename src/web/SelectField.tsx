import { Select } from '@radix-ui/themes'

interface SelectFieldProps<T extends string> {
	label: string
	value: T
	options: readonly { value: T; label: string }[]
	onChange: (value: T) => void
	disabled?: boolean
	id?: string
}

export function SelectField<T extends string>({
	label,
	value,
	options,
	onChange,
	disabled,
	id,
}: SelectFieldProps<T>) {
	return (
		<Select.Root value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
			<Select.Trigger id={id} aria-label={label} className="select-trigger" />
			<Select.Content position="popper" sideOffset={6}>
				{options.map((option) => (
					<Select.Item key={option.value} value={option.value}>
						{option.label}
					</Select.Item>
				))}
			</Select.Content>
		</Select.Root>
	)
}
