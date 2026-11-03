import { TextField } from '@radix-ui/themes'
import type { ComponentProps } from 'react'

export function UiInput(props: ComponentProps<typeof TextField.Root>) {
	return <TextField.Root size="1" className="ui-input" {...props} />
}
