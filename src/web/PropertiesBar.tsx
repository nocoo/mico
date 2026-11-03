import { Palette, Pipette, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { Shape } from '../shared/types'
import { SHAPE_COLORS } from './design'
import { IconButton } from './IconButton'

interface PropertiesBarProps {
	selected: Shape
	onColorChange: (color: string) => void
	onClose: () => void
	children?: ReactNode
}

export function PropertiesBar({ selected, onColorChange, onClose, children }: PropertiesBarProps) {
	const [colorOpen, setColorOpen] = useState(false)
	const root = useRef<HTMLElement>(null)

	useEffect(() => {
		if (!colorOpen) return
		root.current?.querySelector<HTMLButtonElement>('.color-row button')?.focus()
		const outside = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node)) setColorOpen(false)
		}
		document.addEventListener('pointerdown', outside)
		return () => document.removeEventListener('pointerdown', outside)
	}, [colorOpen])

	return (
		<section
			className="selection-properties"
			aria-label="Selected object properties"
			data-selected-id={selected.id}
			ref={root}
			onKeyDown={(event) => {
				if (event.key !== 'Escape' || !colorOpen) return
				event.stopPropagation()
				setColorOpen(false)
				root.current?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus()
			}}
		>
			<strong className="selection-summary">{selected.type}</strong>
			<div className="properties-fields">{children}</div>
			<IconButton
				icon={Palette}
				label="Shape color"
				className="property-color"
				aria-expanded={colorOpen}
				aria-controls="shape-color-panel"
				onClick={() => setColorOpen(!colorOpen)}
			>
				<span className="color-indicator" style={{ background: selected.color }} />
			</IconButton>
			<IconButton icon={X} label="Close properties" className="property-close" onClick={onClose} />
			{colorOpen && (
				<section
					className="properties-popover floating-panel"
					id="shape-color-panel"
					aria-label="Shape color"
				>
					<div className="panel-heading">
						<strong>Color</strong>
						<span>Selected object</span>
					</div>
					<div className="color-row">
						{SHAPE_COLORS.map(({ value, label }) => (
							<button
								type="button"
								key={value}
								className={selected.color === value ? 'chosen' : ''}
								style={{ background: value }}
								aria-label={`Set color ${label}`}
								aria-pressed={selected.color === value}
								title={label}
								onClick={() => {
									onColorChange(value)
									setColorOpen(false)
								}}
							/>
						))}
						<label className="custom-color" title={`Custom color (${selected.color})`}>
							<Pipette aria-hidden="true" strokeWidth={1.5} />
							<input
								type="color"
								value={selected.color}
								onChange={(event) => onColorChange(event.target.value)}
								aria-label="Custom color"
							/>
						</label>
					</div>
				</section>
			)}
		</section>
	)
}
