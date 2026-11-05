import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasListItem, IdentityActions, IdentityState } from './frame/contracts.ts'
import {
	createIdentityViewModel,
	deriveIdentityStatus,
	formatCanvasTime,
	getRenameCommitName,
	identityInteractionReducer,
	initialIdentityInteractionState,
} from './frame/identity/identityViewModel.ts'

const canvases: readonly CanvasListItem[] = [
	{
		id: 'alpha',
		name: 'Alpha',
		updatedAt: '2026-01-01T00:00:00.000Z',
		preview: 'preview-alpha',
	},
	{
		id: 'beta',
		name: 'Beta',
		updatedAt: '2026-01-01T00:01:00.000Z',
	},
]

const baseState: IdentityState = {
	canvases,
	activeCanvasId: 'alpha',
	canvasesOpen: false,
	apiConnected: true,
	wsConnected: true,
	revision: 7,
	objectCount: 12,
}

function actionsSpy(): IdentityActions & { calls: string[] } {
	const calls: string[] = []
	return {
		calls,
		toggleCanvases: () => calls.push('toggle'),
		closeCanvases: () => calls.push('close'),
		createCanvas: () => calls.push('create'),
		switchCanvas: (id) => calls.push(`switch:${id}`),
		renameCanvas: (id, name) => calls.push(`rename:${id}:${name}`),
		deleteCanvas: (id) => calls.push(`delete:${id}`),
	}
}

test('identity status preserves offline, live, and reconnecting precedence', () => {
	assert.deepEqual(deriveIdentityStatus(baseState), {
		status: 'live',
		statusLabel: 'Live',
		statusTitle: 'Revision 7 · 12 objects · Live',
	})
	assert.equal(
		deriveIdentityStatus({ ...baseState, apiConnected: false, wsConnected: true }).status,
		'offline',
	)
	assert.equal(deriveIdentityStatus({ ...baseState, wsConnected: false }).status, 'reconnecting')
	assert.equal(
		deriveIdentityStatus({ ...baseState, apiConnected: false, wsConnected: false }).statusLabel,
		'Offline',
	)
})

test('canvas rename commit trims names and rejects empty or unchanged values', () => {
	assert.equal(getRenameCommitName(canvases, 'alpha', '  Alpha  '), null)
	assert.equal(getRenameCommitName(canvases, 'alpha', '   '), null)
	assert.equal(getRenameCommitName(canvases, 'alpha', '  Renamed Alpha  '), 'Renamed Alpha')
	assert.equal(getRenameCommitName(canvases, 'missing', 'New name'), 'New name')
})

test('relative canvas time preserves invalid and recent fallbacks', () => {
	const now = Date.parse('2026-01-01T00:00:30.000Z')
	assert.equal(formatCanvasTime('not-a-date', now), '')
	assert.equal(formatCanvasTime('2026-01-01T00:00:10.000Z', now), 'just now')
})

test('identity interaction reducer mounts, renames, confirms, cancels, and unmounts', () => {
	let state = initialIdentityInteractionState(false)
	assert.equal(state.mounted, false)
	state = identityInteractionReducer(state, { type: 'sync-open', open: true })
	assert.equal(state.mounted, true)

	state = identityInteractionReducer(state, { type: 'begin-rename', id: 'alpha', name: 'Alpha' })
	assert.equal(state.renamingId, 'alpha')
	assert.equal(state.renameValue, 'Alpha')
	state = identityInteractionReducer(state, { type: 'set-rename', value: '  Alpha 2  ' })
	assert.equal(state.renameValue, '  Alpha 2  ')
	state = identityInteractionReducer(state, { type: 'commit-rename' })
	assert.equal(state.renamingId, null)

	state = identityInteractionReducer(state, { type: 'request-delete', id: 'beta' })
	assert.equal(state.confirmDeleteId, 'beta')
	state = identityInteractionReducer(state, { type: 'clear-delete-confirm' })
	assert.equal(state.confirmDeleteId, null)

	state = identityInteractionReducer(state, { type: 'cancel-rename' })
	assert.equal(state.renamingId, null)
	assert.equal(state.renameCancelled, true)

	state = identityInteractionReducer(state, { type: 'sync-open', open: false })
	assert.equal(state.mounted, true)
	state = identityInteractionReducer(state, { type: 'unmount' })
	assert.equal(state.mounted, false)
})

test('identity protocol routes all real canvas actions and derived deletion state', () => {
	const actions = actionsSpy()
	const viewModel = createIdentityViewModel(baseState, actions)

	viewModel.toggleCanvases()
	viewModel.closeCanvases()
	viewModel.createCanvas()
	viewModel.switchCanvas('beta')
	viewModel.renameCanvas('beta', 'Beta 2')
	viewModel.deleteCanvas('beta')

	assert.deepEqual(actions.calls, [
		'toggle',
		'close',
		'create',
		'switch:beta',
		'rename:beta:Beta 2',
		'delete:beta',
	])
	assert.equal(viewModel.canDeleteCanvas, true)
	assert.equal(
		createIdentityViewModel({ ...baseState, canvases: canvases.slice(0, 1) }, actions)
			.canDeleteCanvas,
		false,
	)
})
