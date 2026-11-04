import {
	Card,
	Flex,
	Grid,
	IconButton as RadixIconButton,
	Separator,
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
	Slash,
	Square,
	StickyNote,
	Type,
	X,
} from 'lucide-react'
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

const field = (label: string, control: React.ReactNode, key?: string) => (
	<Flex key={key ?? label} direction="column" gap="1" style={{ minWidth: 0 }}>
		<Text size="1" color="gray" weight="medium">
			{label}
		</Text>
		{control}
	</Flex>
)

function shapeLabel(shape: CanvasShape) {
	if (shape.type === 'frame' || shape.type === 'html') return shape.title || shape.id
	return shape.text || shape.id
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
	const peer = shape?.type === 'connector' ? shapes.find((item) => item.id === shape.from) : null
	const shapeClass: ShapeType =
		peer && peer.type !== 'connector'
			? peer.type
			: shape && shape.type !== 'connector'
				? shape.type
				: 'rectangle'

	return (
		<Card
			className="selection-panel"
			role="region"
			aria-label="Selected object properties"
			size="1"
			variant="surface"
		>
			<Flex align="center" justify="between" gap="2">
				<Flex align="center" gap="2" style={{ minWidth: 0 }}>
					<Flex align="center" justify="center" className="selection-icon">
						<Icon size={14} strokeWidth={1.5} aria-hidden="true" />
					</Flex>
					<Text size="2" weight="medium" truncate>
						{title}
					</Text>
				</Flex>
				<Flex align="center" gap="1">
					<Tooltip content="Close properties">
						<RadixIconButton
							size="1"
							variant="ghost"
							aria-label="Close properties"
							onClick={onClose}
						>
							<X size={14} />
						</RadixIconButton>
					</Tooltip>
				</Flex>
			</Flex>

			{shape && (
				<>
					<Separator size="4" />
					<Flex direction="column" gap="2">
						{shape.type === 'text' && (
							<>
								{field(
									'Content',
									<TextArea
										id="shape-text"
										aria-label="Text"
										key={`${shape.id}:${shape.text}`}
										defaultValue={shape.text ?? ''}
										rows={2}
										onBlur={(event) => onPatch({ text: event.target.value })}
										onKeyDown={(event) => {
											if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
												event.currentTarget.blur()
										}}
									/>,
								)}
								{field(
									'Font',
									<SelectField
										label="Font family"
										value={shape.font ?? 'sans'}
										options={FONT_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
										onChange={(font) => onPatch({ font })}
									/>,
								)}
								<Grid columns="2" gap="2">
									{field(
										'Size',
										<SelectField
											label="Font size"
											value={String(shape.fontSize ?? 32)}
											options={FONT_SIZES.map((size) => ({
												value: String(size),
												label: String(size),
											}))}
											onChange={(size) => onPatch({ fontSize: Number(size) })}
										/>,
									)}
									{field(
										'Weight',
										<SelectField
											label="Font weight"
											value={String(shape.fontWeight ?? 500)}
											options={FONT_WEIGHTS.map((weight) => ({
												value: String(weight),
												label: String(weight),
											}))}
											onChange={(weight) => onPatch({ fontWeight: Number(weight) })}
										/>,
									)}
								</Grid>
							</>
						)}
						{shape.type === 'note' &&
							field(
								'Content',
								<TextArea
									id="shape-text"
									aria-label="Text"
									key={`${shape.id}:${shape.text}`}
									defaultValue={shape.text ?? ''}
									rows={4}
									onBlur={(event) => onPatch({ text: event.target.value })}
									onKeyDown={(event) => {
										if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
											event.currentTarget.blur()
									}}
								/>,
							)}
						{(shape.type === 'rectangle' || shape.type === 'ellipse') &&
							field(
								'Text',
								<TextField.Root
									id="shape-text"
									aria-label="Text"
									key={`${shape.id}:${shape.text}`}
									defaultValue={shape.text ?? ''}
									onBlur={(event) => onPatch({ text: event.target.value })}
									onKeyDown={(event) => {
										if (event.key === 'Enter') event.currentTarget.blur()
									}}
								/>,
							)}
						{shape.type === 'frame' &&
							field(
								'Frame title',
								<TextField.Root
									id="frame-title"
									aria-label="Frame title"
									key={`${shape.id}:${shape.title}`}
									defaultValue={shape.title ?? ''}
									onBlur={(event) => onPatch({ title: event.target.value })}
									onKeyDown={(event) => {
										if (event.key === 'Enter') event.currentTarget.blur()
									}}
								/>,
							)}
						{shape.type === 'path' && (
							<Grid columns="2" gap="2">
								{field(
									'Brush',
									<SelectField
										label="Brush style"
										value={shape.brush ?? 'brush'}
										options={BRUSH_STYLES.map(({ id, label }) => ({ value: id, label }))}
										onChange={(brush) => onPatch({ brush })}
									/>,
								)}
								{field(
									'Width',
									<SelectField
										label="Stroke width"
										value={String(shape.strokeWidth ?? 4)}
										options={BRUSH_WIDTHS.map((width) => ({
											value: String(width),
											label: `${width}px`,
										}))}
										onChange={(width) => onPatch({ strokeWidth: Number(width) })}
									/>,
								)}
							</Grid>
						)}
						{shape.type === 'connector' && (
							<Grid columns="2" gap="2">
								{field(
									'Source',
									<SelectField
										label="Source"
										value={shape.from}
										options={shapes
											.filter(
												(candidate): candidate is CanvasShape =>
													candidate.type !== 'connector' &&
													candidate.id !== shape.to &&
													connectionCompatible(candidate.type, shapeClass),
											)
											.map((candidate) => ({
												value: candidate.id,
												label: shapeLabel(candidate),
											}))}
										onChange={(id) => onReconnect('from', id)}
									/>,
								)}
								{field(
									'Target',
									<SelectField
										label="Target"
										value={shape.to}
										options={shapes
											.filter(
												(candidate): candidate is CanvasShape =>
													candidate.type !== 'connector' &&
													candidate.id !== shape.from &&
													connectionCompatible(candidate.type, shapeClass),
											)
											.map((candidate) => ({
												value: candidate.id,
												label: shapeLabel(candidate),
											}))}
										onChange={(id) => onReconnect('to', id)}
									/>,
								)}
							</Grid>
						)}
						{shape.type === 'html' &&
							field(
								'Card title',
								<TextField.Root
									id="html-title"
									aria-label="Card title"
									key={`${shape.id}:${shape.title}`}
									defaultValue={shape.title ?? ''}
									onBlur={(event) => onPatch({ title: event.target.value })}
									onKeyDown={(event) => {
										if (event.key === 'Enter') event.currentTarget.blur()
									}}
								/>,
							)}
						<Flex direction="column" gap="1">
							<Text size="1" color="gray" weight="medium">
								Color
							</Text>
							<Flex align="center" gap="2" aria-label="Shape color">
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
								<label className="color-custom" title="Custom color">
									<input
										type="color"
										value={shape.color}
										aria-label="Custom color"
										onChange={(event) => onColor(event.target.value)}
									/>
								</label>
							</Flex>
						</Flex>
					</Flex>
				</>
			)}
		</Card>
	)
}
