import type { BrushStyle, FontFamily } from '../../shared/types'
import type { Tool } from '../design'
import type { ConnectionState } from './connection'

export interface CanvasListItem {
	id: string
	name: string
	updatedAt: string
	preview?: string
}

export interface IdentityState {
	canvases: readonly CanvasListItem[]
	activeCanvasId: string
	canvasesOpen: boolean
}

export interface IdentityActions {
	toggleCanvases: () => void
	closeCanvases: () => void
	createCanvas: () => void
	switchCanvas: (id: string) => void
	renameCanvas: (id: string, name: string) => void
	deleteCanvas: (id: string) => void
}

export type BrushWidth = 2 | 4 | 8

export interface ToolbarState {
	tool: Tool
	zoom: number
	canDelete: boolean
	canFrame: boolean
	brushStyle: BrushStyle
	brushWidth: BrushWidth
	noteColor: string
	textFont: FontFamily
	textSize: number
	textWeight: number
}

export interface DockLayout {
	left: number
	height: number
}

export interface ToolbarActions {
	reportLayout: (layout: DockLayout | null) => void
	selectTool: (tool: Tool) => void
	zoom: (factor: number) => void
	resetView: () => void
	fitBoard: () => void
	deleteSelection: () => void
	frameSelection: () => void
	setBrushStyle: (style: BrushStyle) => void
	setBrushWidth: (width: BrushWidth) => void
	setNoteColor: (color: string) => void
	setTextFont: (font: FontFamily) => void
	setTextSize: (size: number) => void
	setTextWeight: (weight: number) => void
}

export interface AssistantState {
	connection: ConnectionState
	open: boolean
	canvasId: string
	selectedIds: string[]
	initialPrompt: string
}

export interface AssistantActions {
	close: () => void
	toggle: () => void
	clearSelection: () => void
	consumeInitialPrompt: () => void
	createCanvas: (name: string) => void
	isGestureActive: () => boolean
}
