import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DockLayout, ToolbarActions, ToolbarState } from './frame/contracts.ts'
import { dockLeft } from './frame/layout.ts'
import {
	calculateToolbarOptionsWidth,
	deriveToolbarViewModel,
	executeToolbarCommand,
	isToolbarArrowNavigationAllowed,
	TOOL_SHORTCUTS,
	toolbarCommandForKey,
} from './frame/toolbar/viewmodel.ts'

const state: ToolbarState = {
	tool: 'path',
	zoom: 1.25,
	canDelete: true,
	canFrame: false,
	brushStyle: 'brush',
	brushWidth: 4,
	noteColor: '#fff2a8',
	textFont: 'sans',
	textSize: 32,
	textWeight: 500,
}

const actions = (): ToolbarActions & { calls: string[] } => {
	const calls: string[] = []
	return {
		calls,
		reportLayout: (layout: DockLayout | null) =>
			calls.push(layout ? `layout:${layout.left}:${layout.height}` : 'layout:null'),
		selectTool: (tool) => calls.push(`tool:${tool}`),
		zoom: (factor) => calls.push(`zoom:${factor}`),
		resetView: () => calls.push('reset'),
		fitBoard: () => calls.push('fit'),
		deleteSelection: () => calls.push('delete'),
		frameSelection: () => calls.push('frame'),
		setBrushStyle: (style) => calls.push(`brush:${style}`),
		setBrushWidth: (width) => calls.push(`brushWidth:${width}`),
		setNoteColor: (color) => calls.push(`note:${color}`),
		setTextFont: (font) => calls.push(`font:${font}`),
		setTextSize: (size) => calls.push(`textSize:${size}`),
		setTextWeight: (weight) => calls.push(`weight:${weight}`),
	}
}

test('toolbar view model derives zoom and tool options', () => {
	assert.deepEqual(deriveToolbarViewModel(state), {
		activeTool: 'path',
		zoomPercent: 125,
		canDelete: true,
		canFrame: false,
		optionsKind: 'brush',
	})
	assert.equal(deriveToolbarViewModel({ ...state, tool: 'note' }).optionsKind, 'note')
	assert.equal(deriveToolbarViewModel({ ...state, tool: 'text' }).optionsKind, 'text')
	assert.equal(deriveToolbarViewModel({ ...state, tool: 'select' }).optionsKind, null)
})

test('tool shortcuts cover every toolbar tool and keyboard protocol', () => {
	assert.deepEqual(
		TOOL_SHORTCUTS.map(({ id, shortcut }) => [id, shortcut]),
		[
			['select', 'V'],
			['hand', 'H'],
			['rectangle', 'R'],
			['ellipse', 'O'],
			['text', 'T'],
			['line', 'L'],
			['path', 'P'],
			['note', 'N'],
			['html', 'W'],
			['connector', 'C'],
		],
	)
	assert.deepEqual(toolbarCommandForKey('p'), { type: 'select-tool', tool: 'path' })
	assert.deepEqual(toolbarCommandForKey('Delete'), { type: 'delete-selection' })
	assert.deepEqual(toolbarCommandForKey('+'), { type: 'zoom-in' })
	assert.deepEqual(toolbarCommandForKey('-'), { type: 'zoom-out' })
	assert.deepEqual(toolbarCommandForKey('0'), { type: 'reset-view' })
	assert.deepEqual(toolbarCommandForKey('f'), { type: 'fit-board' })
	assert.equal(toolbarCommandForKey('r', { metaKey: true, ctrlKey: false, altKey: false }), null)
})

test('arrow navigation is restricted to drawing and view controls', () => {
	assert.equal(isToolbarArrowNavigationAllowed('drawing'), true)
	assert.equal(isToolbarArrowNavigationAllowed('view'), true)
	assert.equal(isToolbarArrowNavigationAllowed('options'), false)
	assert.equal(isToolbarArrowNavigationAllowed('selection'), false)
	assert.equal(isToolbarArrowNavigationAllowed('outside'), false)
})

test('toolbar commands preserve action guards and zoom factors', () => {
	const calls = actions()
	executeToolbarCommand({ type: 'select-tool', tool: 'text' }, state, calls)
	executeToolbarCommand({ type: 'delete-selection' }, state, calls)
	executeToolbarCommand({ type: 'frame-selection' }, state, calls)
	executeToolbarCommand({ type: 'zoom-in' }, state, calls)
	executeToolbarCommand({ type: 'zoom-out' }, state, calls)
	executeToolbarCommand({ type: 'reset-view' }, state, calls)
	executeToolbarCommand({ type: 'fit-board' }, state, calls)
	assert.deepEqual(calls.calls, [
		'tool:text',
		'delete',
		'zoom:1.2',
		'zoom:0.8333333333333334',
		'reset',
		'fit',
	])

	const blocked = actions()
	executeToolbarCommand({ type: 'delete-selection' }, { ...state, canDelete: false }, blocked)
	executeToolbarCommand({ type: 'frame-selection' }, { ...state, canFrame: false }, blocked)
	assert.deepEqual(blocked.calls, [])
})

test('toolbar options width includes divider and horizontal padding', () => {
	assert.equal(calculateToolbarOptionsWidth(264, 8, 0), 272)
	assert.equal(calculateToolbarOptionsWidth(264, 8, 6), 278)
	assert.equal(calculateToolbarOptionsWidth(0, 8, 0), 8)
})

test('measured dock placement uses the shared frame layout contract', () => {
	assert.equal(dockLeft(1000, 520), 240)
	assert.equal(dockLeft(375, 320), 28)
	assert.equal(dockLeft(384, 300), 44)

	const calls = actions()
	calls.reportLayout({ left: dockLeft(1000, 520), height: 56 })
	calls.reportLayout(null)
	assert.deepEqual(calls.calls, ['layout:240:56', 'layout:null'])
})
