import {
	ArrowUpRight,
	Brush,
	Circle,
	CodeXml,
	Frame,
	Hand,
	Image as ImageIcon,
	Maximize,
	Minus,
	MousePointer2,
	Plus,
	Slash,
	Square,
	StickyNote,
	Trash2,
	Type,
} from 'lucide-react'
import {
	Fragment,
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
} from 'react'
import './toolbar.css'
import {
	BRUSH_STYLES,
	BRUSH_WIDTHS,
	FONT_OPTIONS,
	FONT_SIZES,
	FONT_STACKS,
	FONT_WEIGHTS,
	NOTE_COLORS,
	type Tool,
} from '../../design'
import { IconButton } from '../../IconButton'
import { SelectField } from '../../SelectField'
import type { ToolbarActions, ToolbarState } from '../contracts'
import {
	calculateToolbarLeft,
	calculateToolbarOptionsWidth,
	deriveToolbarViewModel,
	executeToolbarCommand,
	isToolbarArrowNavigationAllowed,
	TOOL_GROUPS,
	toolbarCommandForKey,
} from './viewmodel'

export interface ToolbarProps {
	state: ToolbarState
	actions: ToolbarActions
}

const toolIcons = {
	select: MousePointer2,
	hand: Hand,
	rectangle: Square,
	ellipse: Circle,
	text: Type,
	line: Slash,
	path: Brush,
	note: StickyNote,
	html: CodeXml,
	image: ImageIcon,
	connector: ArrowUpRight,
} satisfies Record<Tool, typeof MousePointer2>

function focusToolInToolbar(dock: HTMLElement | null, tool: Tool): void {
	const focused = document.activeElement
	if (
		!(focused instanceof HTMLElement) ||
		!dock?.contains(focused) ||
		!focused.closest('.tool-slot')
	) {
		return
	}
	dock.querySelector<HTMLButtonElement>(`.tool-slot[data-tool-id="${tool}"] .icon-button`)?.focus()
}

export function Toolbar({ state, actions }: ToolbarProps) {
	const dockRef = useRef<HTMLDivElement>(null)
	const toolOptionsWrapRef = useRef<HTMLDivElement>(null)
	const viewModel = deriveToolbarViewModel(state)
	const { reportLayout } = actions

	useLayoutEffect(() => {
		focusToolInToolbar(dockRef.current, state.tool)
	}, [state.tool])

	useLayoutEffect(() => {
		const dock = dockRef.current
		if (!dock) {
			reportLayout(null)
			return
		}
		const measure = () => {
			const rect = dock.getBoundingClientRect()
			const panelReserved =
				Number.parseFloat(getComputedStyle(dock).getPropertyValue('--frame-panel-reserved')) || 0
			reportLayout({
				left: calculateToolbarLeft(window.innerWidth, rect.width, panelReserved),
				height: rect.height,
			})
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(dock)
		window.addEventListener('resize', measure)
		return () => {
			observer.disconnect()
			window.removeEventListener('resize', measure)
			reportLayout(null)
		}
	}, [reportLayout])

	useLayoutEffect(() => {
		const wrap = toolOptionsWrapRef.current
		if (!wrap) return
		const optionsKind = viewModel.optionsKind
		const options = wrap.querySelector<HTMLElement>('.brush-options')
		const divider = wrap.querySelector<HTMLElement>('.tool-options-divider')
		const measure = () => {
			if (!options || optionsKind === null) {
				wrap.classList.remove('open')
				wrap.style.setProperty('--toolbar-options-width', '0px')
				return
			}
			wrap.classList.add('open')
			const styles = getComputedStyle(wrap)
			const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
			const width = calculateToolbarOptionsWidth(
				options.offsetWidth ?? 0,
				divider?.offsetWidth ?? 0,
				horizontalPadding,
			)
			wrap.style.setProperty('--toolbar-options-width', `${width}px`)
		}
		measure()
		const observer = options ? new ResizeObserver(measure) : null
		if (options) observer?.observe(options)
		window.addEventListener('resize', measure)
		return () => {
			observer?.disconnect()
			window.removeEventListener('resize', measure)
			wrap.style.removeProperty('--toolbar-options-width')
		}
	}, [viewModel.optionsKind])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement
			if (target.closest('.selection-panel, .select-content')) return
			if (target.closest('input, textarea, select, [contenteditable="true"]')) return
			const command = toolbarCommandForKey(event.key, {
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				altKey: event.altKey,
			})
			if (!command) return
			if (command.type === 'delete-selection') event.preventDefault()
			executeToolbarCommand(command, state, actions)
			if (command.type === 'select-tool') focusToolInToolbar(dockRef.current, command.tool)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [state, actions])

	const onToolbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
		const target = event.target as Element
		const region = target.closest('.selection-panel')
			? 'selection'
			: target.closest('.drawing-tools')
				? 'drawing'
				: target.closest('.view-controls')
					? 'view'
					: target.closest('.tool-options-wrap')
						? 'options'
						: 'outside'
		if (!isToolbarArrowNavigationAllowed(region)) return
		event.preventDefault()
		const buttons = [
			...event.currentTarget.querySelectorAll<HTMLButtonElement>(
				'.dock-main .icon-button:not(:disabled), .dock-main .zoom-value',
			),
		]
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? buttons.length - 1
					: (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
		buttons[next]?.focus()
	}

	const toolOptions =
		viewModel.optionsKind === 'brush' ? (
			<fieldset className="brush-options" aria-label="Brush options">
				<div className="segmented-control brush-styles">
					{BRUSH_STYLES.map(({ id, label }) => (
						<button
							type="button"
							key={id}
							aria-pressed={state.brushStyle === id}
							aria-label={`Brush style ${label}`}
							onClick={() => actions.setBrushStyle(id)}
						>
							{label}
						</button>
					))}
				</div>
				<div className="segmented-control brush-widths">
					{BRUSH_WIDTHS.map((width) => (
						<button
							type="button"
							key={width}
							aria-pressed={state.brushWidth === width}
							aria-label={`Brush width ${width}px`}
							onClick={() => actions.setBrushWidth(width)}
						>
							{width}
						</button>
					))}
				</div>
			</fieldset>
		) : viewModel.optionsKind === 'note' ? (
			<fieldset className="brush-options" aria-label="Sticky colors">
				<div className="segmented-control note-colors">
					{NOTE_COLORS.map(({ value, label }) => (
						<button
							type="button"
							key={value}
							aria-pressed={state.noteColor === value}
							aria-label={`${label} sticky`}
							style={{ background: value }}
							onClick={() => actions.setNoteColor(value)}
						/>
					))}
				</div>
			</fieldset>
		) : viewModel.optionsKind === 'text' ? (
			<fieldset className="brush-options text-options" aria-label="Text options">
				<SelectField
					label="Font family"
					value={state.textFont}
					options={FONT_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
					onChange={actions.setTextFont}
					side="top"
					renderItem={(option) => (
						<span
							style={{
								fontFamily: FONT_STACKS[option.value as keyof typeof FONT_STACKS],
								fontSize: 16,
								fontWeight: state.textWeight,
							}}
						>
							{option.label}
						</span>
					)}
				/>
				<SelectField
					label="Font size"
					value={String(state.textSize)}
					options={FONT_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
					onChange={(size) => actions.setTextSize(Number(size))}
					side="top"
					renderItem={(option) => (
						<span
							style={{
								fontFamily: FONT_STACKS[state.textFont as keyof typeof FONT_STACKS],
								fontSize: Number(option.value),
								fontWeight: state.textWeight,
							}}
						>
							{option.label}
						</span>
					)}
				/>
				<SelectField
					label="Font weight"
					value={String(state.textWeight)}
					options={FONT_WEIGHTS.map((weight) => ({ value: String(weight), label: String(weight) }))}
					onChange={(weight) => actions.setTextWeight(Number(weight))}
					side="top"
					renderItem={(option) => (
						<span
							style={{
								fontFamily: FONT_STACKS[state.textFont as keyof typeof FONT_STACKS],
								fontSize: 16,
								fontWeight: Number(option.value),
							}}
						>
							{option.label}
						</span>
					)}
				/>
			</fieldset>
		) : null

	return (
		<div
			className="toolbar floating-panel toolbar-module"
			ref={dockRef}
			role="toolbar"
			aria-label="Canvas tools"
			onKeyDown={onToolbarKeyDown}
		>
			<div className="dock-main">
				<div className="drawing-tools">
					{TOOL_GROUPS.map((group, groupIndex) => (
						<Fragment key={group[0].id}>
							{groupIndex > 0 && <span className="panel-divider" />}
							{group.map(({ id, label, shortcut }) => (
								<div className="tool-slot" key={id} data-tool-id={id}>
									<IconButton
										icon={toolIcons[id]}
										label={label}
										shortcut={shortcut}
										aria-pressed={state.tool === id}
										tabIndex={state.tool === id ? 0 : -1}
										onClick={() => actions.selectTool(id)}
									/>
								</div>
							))}
						</Fragment>
					))}
					<span className="panel-divider" />
					<IconButton
						icon={Trash2}
						label="Delete selected"
						shortcut="Delete"
						tabIndex={-1}
						disabled={!viewModel.canDelete}
						onClick={actions.deleteSelection}
						className="delete-tool"
					/>
					<IconButton
						icon={Frame}
						label="Frame selection"
						tabIndex={-1}
						disabled={!viewModel.canFrame}
						onClick={actions.frameSelection}
					/>
				</div>
				<div className="tool-options-wrap" ref={toolOptionsWrapRef}>
					<span className="panel-divider tool-options-divider" />
					{toolOptions}
				</div>
				<span className="panel-divider dock-divider" />
				<fieldset className="view-controls" aria-label="View controls">
					<div className="zoom-controls">
						<IconButton
							icon={Minus}
							label="Zoom out"
							shortcut="−"
							tabIndex={-1}
							onClick={() => actions.zoom(1 / 1.2)}
						/>
						<button
							className="zoom-value text-button"
							type="button"
							tabIndex={-1}
							onClick={actions.resetView}
							aria-label="Reset view"
							title="Reset view (0)"
						>
							{viewModel.zoomPercent}%
						</button>
						<IconButton
							icon={Plus}
							label="Zoom in"
							shortcut="+"
							tabIndex={-1}
							onClick={() => actions.zoom(1.2)}
						/>
					</div>
					<span className="panel-divider" />
					<IconButton
						icon={Maximize}
						label="Fit board"
						shortcut="F"
						tabIndex={-1}
						onClick={actions.fitBoard}
					/>
				</fieldset>
			</div>
		</div>
	)
}
