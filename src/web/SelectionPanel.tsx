import {
	Button,
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
	Frame,
	LayoutGrid,
	Slash,
	Square,
	StickyNote,
	Trash2,
	Type,
	X,
} from 'lucide-react'
import type { CanvasShape, Operation, Shape } from '../shared/types'
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
	onFrame: () => void
	onDelete: () => void
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
	widget: LayoutGrid,
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
	widget: 'Rich widget',
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

function itemsOf(shape: Shape) {
	return shape.type === 'widget' ? (shape.items ?? []) : []
}

export function SelectionPanel({
	shape,
	count,
	shapes,
	onClose,
	onPatch,
	onColor,
	onFrame,
	onDelete,
	onReconnect,
}: SelectionPanelProps) {
	if (!shape && count === 0) return null
	const Icon = shape ? (icons[shape.type] ?? Square) : LayoutGrid
	const title = shape
		? shape.type === 'frame'
			? (shape.title ?? 'Frame')
			: shape.type === 'widget'
				? (shape.widgetTitle ?? 'Rich widget')
				: (labels[shape.type] ?? shape.type)
		: `${count} objects selected`

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
								<Grid columns="3" gap="2">
									{field(
										'Font',
										<SelectField
											label="Font family"
											value={shape.font ?? 'sans'}
											options={FONT_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
											onChange={(font) => onPatch({ font })}
										/>,
									)}
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
													candidate.type !== 'connector' && candidate.id !== shape.to,
											)
											.map((candidate) => ({
												value: candidate.id,
												label: candidate.text || candidate.id,
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
													candidate.type !== 'connector' && candidate.id !== shape.from,
											)
											.map((candidate) => ({
												value: candidate.id,
												label: candidate.text || candidate.id,
											}))}
										onChange={(id) => onReconnect('to', id)}
									/>,
								)}
							</Grid>
						)}
						{shape.type === 'widget' && (
							<>
								{field(
									'Widget title',
									<TextField.Root
										id="widget-title"
										aria-label="Widget title"
										key={`${shape.id}:${shape.widgetTitle}`}
										defaultValue={shape.widgetTitle ?? ''}
										onBlur={(event) => onPatch({ widgetTitle: event.target.value })}
										onKeyDown={(event) => {
											if (event.key === 'Enter') event.currentTarget.blur()
										}}
									/>,
								)}
								<Flex direction="column" gap="1">
									<Text size="1" color="gray" weight="medium">
										Items
									</Text>
									<Grid gap="1" className="widget-rows">
										{itemsOf(shape).map((item) => (
											<Grid
												columns={
													shape.widget === 'kanban'
														? '1fr 96px 24px'
														: shape.widget === 'timeline'
															? '1fr 56px 56px 24px'
															: shape.widget === 'todo'
																? '1fr 24px'
																: '1fr 24px'
												}
												gap="1"
												align="center"
												key={item.id}
											>
												<TextField.Root
													size="1"
													aria-label={`Item ${item.title}`}
													defaultValue={item.title}
													key={`${item.id}:${item.title}`}
													onBlur={(event) => {
														const title = event.target.value.trim()
														if (title && title !== item.title) {
															onPatch({
																items: itemsOf(shape).map((candidate) =>
																	candidate.id === item.id ? { ...candidate, title } : candidate,
																),
															})
														}
													}}
												/>
												{shape.widget === 'kanban' && (
													<SelectField
														label={`Status ${item.title}`}
														value={item.status ?? 'todo'}
														options={[
															{ value: 'todo', label: 'todo' },
															{ value: 'doing', label: 'doing' },
															{ value: 'done', label: 'done' },
														]}
														onChange={(status) =>
															onPatch({
																items: itemsOf(shape).map((candidate) =>
																	candidate.id === item.id ? { ...candidate, status } : candidate,
																),
															})
														}
													/>
												)}
												{shape.widget === 'timeline' && (
													<>
														<TextField.Root
															size="1"
															type="number"
															aria-label={`Start ${item.title}`}
															defaultValue={item.start ?? 0}
															key={`start:${item.id}:${item.start}`}
															onBlur={(event) =>
																onPatch({
																	items: itemsOf(shape).map((candidate) =>
																		candidate.id === item.id
																			? { ...candidate, start: Number(event.target.value) }
																			: candidate,
																	),
																})
															}
														/>
														<TextField.Root
															size="1"
															type="number"
															aria-label={`End ${item.title}`}
															defaultValue={item.end ?? 1}
															key={`end:${item.id}:${item.end}`}
															onBlur={(event) =>
																onPatch({
																	items: itemsOf(shape).map((candidate) =>
																		candidate.id === item.id
																			? { ...candidate, end: Number(event.target.value) }
																			: candidate,
																	),
																})
															}
														/>
													</>
												)}
												{shape.widget === 'todo' && (
													<RadixIconButton
														size="1"
														variant="soft"
														aria-label={`Toggle ${item.title}`}
														onClick={() =>
															onPatch({
																items: itemsOf(shape).map((candidate) =>
																	candidate.id === item.id
																		? { ...candidate, done: !candidate.done }
																		: candidate,
																),
															})
														}
													>
														<span aria-hidden="true">{item.done ? '✓' : '·'}</span>
													</RadixIconButton>
												)}
												<RadixIconButton
													size="1"
													variant="ghost"
													color="red"
													aria-label={`Remove ${item.title}`}
													onClick={() =>
														onPatch({
															items: itemsOf(shape).filter((candidate) => candidate.id !== item.id),
														})
													}
												>
													<Trash2 size={12} />
												</RadixIconButton>
											</Grid>
										))}
									</Grid>
									<Button
										size="1"
										variant="soft"
										aria-label="Add widget item"
										onClick={() =>
											onPatch({
												items: [
													...itemsOf(shape),
													{
														id: crypto.randomUUID(),
														title: 'New item',
														...(shape.widget === 'kanban' ? { status: 'todo' } : {}),
														...(shape.widget === 'timeline'
															? { start: itemsOf(shape).length, end: itemsOf(shape).length + 2 }
															: {}),
													},
												],
											})
										}
									>
										Add item
									</Button>
								</Flex>
							</>
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
