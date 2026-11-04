import {
	Card,
	IconButton as RadixIconButton,
	Text,
	TextArea,
	TextField,
	Tooltip,
} from '@radix-ui/themes'
import {
	ArrowUpRight,
	Brush,
	Circle,
	CodeXml,
	Frame,
	MousePointer2,
	Palette,
	Pipette,
	Slash,
	Square,
	StickyNote,
	Type,
	X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { CanvasShape, Operation, Shape, ShapeType } from '../shared/types'
import { connectionCompatible } from '../shared/types'
import {
	BRUSH_STYLES,
	BRUSH_WIDTHS,
	FONT_OPTIONS,
	FONT_SIZES,
	FONT_WEIGHTS,
	SHAPE_COLORS,
} from './design'
import { SelectField } from './SelectField'

type Patch = Extract<Operation, { type: 'update' }>['patch']

interface SelectionPanelProps {
	shape: Shape | null
	count: number
	shapes: Shape[]
	onClose: () => void
	onPatch: (patch: Patch) => void
	onColor: (color: string) => void
	onReconnect: (endpoint: 'from' | 'to', id: string) => void
}

const icons: Partial<Record<Shape['type'], typeof Square>> = {
	rectangle: Square,
	ellipse: Circle,
	text: Type,
	line: Slash,
	path: Brush,
	note: StickyNote,
	frame: Frame,
	html: CodeXml,
	connector: ArrowUpRight,
}

const labels: Partial<Record<Shape['type'], string>> = {
	rectangle: 'Rectangle',
	ellipse: 'Ellipse',
	text: 'Text',
	line: 'Line',
	path: 'Brush stroke',
	note: 'Sticky note',
	frame: 'Frame',
	html: 'HTML card',
	connector: 'Connector',
}

function shapeLabel(shape: CanvasShape) {
	if (shape.type === 'frame' || shape.type === 'html') return shape.title || shape.id
	return shape.text || shape.id
}

function Field({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
	return (
		<div className="panel-field">
			{id ? (
				<label className="panel-label" htmlFor={id}>
					{label}
				</label>
			) : (
				<span className="panel-label">{label}</span>
			)}
			{children}
		</div>
	)
}

function connectorClass(connector: Shape, shapes: Shape[]): ShapeType {
	if (connector.type !== 'connector') return connector.type
	const peer = shapes.find((candidate) => candidate.id === connector.from)
	return peer && peer.type !== 'connector' ? peer.type : 'rectangle'
}

export function SelectionPanel({
	shape,
	count,
	shapes,
	onClose,
	onPatch,
	onColor,
	onReconnect,
}: SelectionPanelProps) {
	if (!shape && count === 0) return null
	const Icon = shape ? (icons[shape.type] ?? Square) : Frame
	const title = shape
		? shape.type === 'frame'
			? (shape.title ?? 'Frame')
			: shape.type === 'html'
				? (shape.title ?? 'HTML card')
				: (labels[shape.type] ?? shape.type)
		: `${count} objects selected`
	const peerClass = shape ? connectorClass(shape, shapes) : 'rectangle'
	const connectorPeers = shapes.filter(
		(candidate): candidate is CanvasShape =>
			candidate.type !== 'connector' && connectionCompatible(candidate.type, peerClass),
	)

	return (
		<Card
			className="selection-panel"
			role="region"
			aria-label="Selected object properties"
			size="1"
			variant="surface"
		>
			<header className="selection-panel-header">
				<div className="selection-panel-heading">
					<span className="selection-icon">
						<Icon size={14} strokeWidth={1.5} aria-hidden="true" />
					</span>
					<Text size="2" weight="medium" truncate>
						{title}
					</Text>
				</div>
				<Tooltip content="Close properties">
					<RadixIconButton size="1" variant="ghost" aria-label="Close properties" onClick={onClose}>
						<X size={14} />
					</RadixIconButton>
				</Tooltip>
			</header>

			<div className="selection-panel-body">
				{!shape && (
					<div className="panel-hint">
						<MousePointer2 size={14} strokeWidth={1.75} aria-hidden="true" />
						<Text size="1" color="gray">
							Drag to move, or use the dock to wrap the selection in a frame or delete it.
						</Text>
					</div>
				)}

				{shape?.type === 'text' && (
					<>
						<Field id="shape-text" label="Text">
							<TextArea
								id="shape-text"
								key={`${shape.id}:${shape.text}`}
								defaultValue={shape.text ?? ''}
								rows={3}
								onBlur={(event) => onPatch({ text: event.target.value })}
								onKeyDown={(event) => {
									if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
										event.currentTarget.blur()
								}}
							/>
						</Field>
						<Field id="text-font-family" label="Font family">
							<SelectField
								id="text-font-family"
								label="Font family"
								value={shape.font ?? 'sans'}
								options={FONT_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
								onChange={(font) => onPatch({ font })}
							/>
						</Field>
						<div className="panel-grid">
							<Field id="text-font-size" label="Size">
								<SelectField
									id="text-font-size"
									label="Font size"
									value={String(shape.fontSize ?? 32)}
									options={FONT_SIZES.map((size) => ({
										value: String(size),
										label: String(size),
									}))}
									onChange={(size) => onPatch({ fontSize: Number(size) })}
								/>
							</Field>
							<Field id="text-font-weight" label="Weight">
								<SelectField
									id="text-font-weight"
									label="Font weight"
									value={String(shape.fontWeight ?? 500)}
									options={FONT_WEIGHTS.map((weight) => ({
										value: String(weight),
										label: String(weight),
									}))}
									onChange={(weight) => onPatch({ fontWeight: Number(weight) })}
								/>
							</Field>
						</div>
					</>
				)}

				{shape?.type === 'note' && (
					<Field id="shape-text" label="Text">
						<TextArea
							id="shape-text"
							key={`${shape.id}:${shape.text}`}
							defaultValue={shape.text ?? ''}
							rows={4}
							onBlur={(event) => onPatch({ text: event.target.value })}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
									event.currentTarget.blur()
							}}
						/>
					</Field>
				)}

				{(shape?.type === 'rectangle' || shape?.type === 'ellipse') && (
					<Field id="shape-text" label="Text">
						<TextField.Root
							id="shape-text"
							key={`${shape.id}:${shape.text}`}
							defaultValue={shape.text ?? ''}
							onBlur={(event) => onPatch({ text: event.target.value })}
							onKeyDown={(event) => {
								if (event.key === 'Enter') event.currentTarget.blur()
							}}
						/>
					</Field>
				)}

				{shape?.type === 'frame' && (
					<Field id="frame-title" label="Frame title">
						<TextField.Root
							id="frame-title"
							key={`${shape.id}:${shape.title}`}
							defaultValue={shape.title ?? ''}
							onBlur={(event) => onPatch({ title: event.target.value })}
							onKeyDown={(event) => {
								if (event.key === 'Enter') event.currentTarget.blur()
							}}
						/>
					</Field>
				)}

				{shape?.type === 'html' && (
					<>
						<Field id="html-title" label="Card title">
							<TextField.Root
								id="html-title"
								key={`${shape.id}:${shape.title}`}
								defaultValue={shape.title ?? ''}
								onBlur={(event) => onPatch({ title: event.target.value })}
								onKeyDown={(event) => {
									if (event.key === 'Enter') event.currentTarget.blur()
								}}
							/>
						</Field>
						<div className="panel-hint">
							<CodeXml size={14} strokeWidth={1.75} aria-hidden="true" />
							<Text size="1" color="gray">
								Markup is generated through the API.
							</Text>
						</div>
					</>
				)}

				{shape?.type === 'path' && (
					<div className="panel-grid">
						<Field id="path-brush" label="Brush">
							<SelectField
								id="path-brush"
								label="Brush style"
								value={shape.brush ?? 'brush'}
								options={BRUSH_STYLES.map(({ id, label }) => ({ value: id, label }))}
								onChange={(brush) => onPatch({ brush })}
							/>
						</Field>
						<Field id="path-width" label="Width">
							<SelectField
								id="path-width"
								label="Stroke width"
								value={String(shape.strokeWidth ?? 4)}
								options={BRUSH_WIDTHS.map((width) => ({
									value: String(width),
									label: `${width}px`,
								}))}
								onChange={(width) => onPatch({ strokeWidth: Number(width) })}
							/>
						</Field>
					</div>
				)}

				{shape?.type === 'connector' && (
					<div className="panel-grid">
						<Field id="connector-source" label="Source">
							<SelectField
								id="connector-source"
								label="Source"
								value={shape.from}
								options={connectorPeers
									.filter((candidate) => candidate.id !== shape.to)
									.map((candidate) => ({
										value: candidate.id,
										label: shapeLabel(candidate),
									}))}
								onChange={(id) => onReconnect('from', id)}
							/>
						</Field>
						<Field id="connector-target" label="Target">
							<SelectField
								id="connector-target"
								label="Target"
								value={shape.to}
								options={connectorPeers
									.filter((candidate) => candidate.id !== shape.from)
									.map((candidate) => ({
										value: candidate.id,
										label: shapeLabel(candidate),
									}))}
								onChange={(id) => onReconnect('to', id)}
							/>
						</Field>
					</div>
				)}

				{shape && (
					<fieldset className="panel-field panel-color">
						<legend className="sr-only">Color</legend>
						<div className="panel-swatches">
							<Palette
								className="panel-swatches-icon"
								size={14}
								strokeWidth={1.75}
								aria-hidden="true"
							/>
							{SHAPE_COLORS.map(({ value, label }) => (
								<button
									type="button"
									key={value}
									className={`color-swatch ${shape.color === value ? 'chosen' : ''}`}
									style={{ background: value }}
									aria-label={`Set color ${label}`}
									aria-pressed={shape.color === value}
									onClick={() => onColor(value)}
								/>
							))}
							<label
								className={`color-custom ${
									SHAPE_COLORS.some(({ value }) => value === shape.color) ? '' : 'chosen'
								}`}
								title="Custom color"
							>
								<Pipette
									className="color-custom-icon"
									size={14}
									strokeWidth={2}
									aria-hidden="true"
								/>
								<input
									type="color"
									value={shape.color}
									aria-label="Custom color"
									onChange={(event) => onColor(event.target.value)}
								/>
							</label>
						</div>
					</fieldset>
				)}
			</div>
		</Card>
	)
}
