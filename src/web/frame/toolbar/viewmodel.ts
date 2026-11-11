import type { Tool } from '../../design'
import type { ToolbarActions, ToolbarState } from '../contracts'

export type ToolbarOptionsKind = 'brush' | 'note' | 'text' | null
export type ToolbarNavigationRegion = 'drawing' | 'view' | 'options' | 'selection' | 'outside'

export interface ToolbarViewModel {
	activeTool: Tool
	zoomPercent: number
	canDelete: boolean
	canFrame: boolean
	optionsKind: ToolbarOptionsKind
}

export const TOOL_GROUPS = [
	[
		{ id: 'select', label: 'Select', shortcut: 'V' },
		{ id: 'hand', label: 'Pan', shortcut: 'H' },
	],
	[
		{ id: 'note', label: 'Sticky note', shortcut: 'N' },
		{ id: 'rectangle', label: 'Rectangle', shortcut: 'R' },
		{ id: 'ellipse', label: 'Ellipse', shortcut: 'O' },
		{ id: 'text', label: 'Text', shortcut: 'T' },
	],
	[
		{ id: 'connector', label: 'Connector', shortcut: 'C' },
		{ id: 'path', label: 'Brush', shortcut: 'P' },
	],
	[
		{ id: 'line', label: 'Line', shortcut: 'L' },
		{ id: 'html', label: 'HTML card', shortcut: 'W' },
		{ id: 'image', label: 'Image', shortcut: 'I' },
	],
] as const satisfies readonly (readonly { id: Tool; label: string; shortcut: string }[])[]

export const TOOL_SHORTCUTS = TOOL_GROUPS.flat()

export function deriveToolbarViewModel(state: ToolbarState): ToolbarViewModel {
	return {
		activeTool: state.tool,
		zoomPercent: Math.round(state.zoom * 100),
		canDelete: state.canDelete,
		canFrame: state.canFrame,
		optionsKind:
			state.tool === 'path'
				? 'brush'
				: state.tool === 'note'
					? 'note'
					: state.tool === 'text'
						? 'text'
						: null,
	}
}

export function isToolbarArrowNavigationAllowed(region: ToolbarNavigationRegion): boolean {
	return region === 'drawing' || region === 'view'
}

export function calculateToolbarOptionsWidth(
	optionsWidth: number,
	dividerWidth: number,
	horizontalPadding: number,
): number {
	return optionsWidth + dividerWidth + horizontalPadding
}

export function calculateToolbarLeft(
	viewportWidth: number,
	toolbarWidth: number,
	panelReserved: number,
): number {
	const remainingWidth = Math.max(0, viewportWidth - panelReserved)
	const centeringWidth = remainingWidth >= toolbarWidth ? remainingWidth : viewportWidth
	return Math.max(0, Math.round((centeringWidth - toolbarWidth) / 2 / 4) * 4)
}

export type ToolbarCommand =
	| { type: 'select-tool'; tool: Tool }
	| { type: 'delete-selection' }
	| { type: 'frame-selection' }
	| { type: 'zoom-in' }
	| { type: 'zoom-out' }
	| { type: 'reset-view' }
	| { type: 'fit-board' }

export function toolbarCommandForKey(
	key: string,
	modifiers: { metaKey: boolean; ctrlKey: boolean; altKey: boolean } = {
		metaKey: false,
		ctrlKey: false,
		altKey: false,
	},
): ToolbarCommand | null {
	if (modifiers.metaKey || modifiers.ctrlKey || modifiers.altKey) return null
	if (key === 'Delete' || key === 'Backspace') return { type: 'delete-selection' }
	if (key === '+' || key === '=') return { type: 'zoom-in' }
	if (key === '-') return { type: 'zoom-out' }
	if (key === '0') return { type: 'reset-view' }
	if (key.toLowerCase() === 'f') return { type: 'fit-board' }

	const tools: Partial<Record<string, Tool>> = {
		v: 'select',
		h: 'hand',
		r: 'rectangle',
		o: 'ellipse',
		t: 'text',
		l: 'line',
		p: 'path',
		n: 'note',
		w: 'html',
		i: 'image',
		c: 'connector',
	}
	const tool = tools[key.toLowerCase()]
	return tool ? { type: 'select-tool', tool } : null
}

export function executeToolbarCommand(
	command: ToolbarCommand,
	state: ToolbarState,
	actions: ToolbarActions,
): void {
	switch (command.type) {
		case 'select-tool':
			actions.selectTool(command.tool)
			return
		case 'delete-selection':
			if (state.canDelete) actions.deleteSelection()
			return
		case 'frame-selection':
			if (state.canFrame) actions.frameSelection()
			return
		case 'zoom-in':
			actions.zoom(1.2)
			return
		case 'zoom-out':
			actions.zoom(1 / 1.2)
			return
		case 'reset-view':
			actions.resetView()
			return
		case 'fit-board':
			actions.fitBoard()
	}
}
