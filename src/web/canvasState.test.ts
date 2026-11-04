import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasSummary } from '../shared/types.ts'
import { mergeSnapshotCanvases, rememberBoard, upsertCanvasSummary } from './canvasState.ts'

const base = (overrides: Partial<CanvasSummary> = {}): CanvasSummary => ({
	id: 'canvas',
	name: 'My canvas',
	revision: 1,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	preview: 'old',
	...overrides,
})

test('a higher revision wins even when the timestamp is identical', () => {
	const current = [base({ revision: 2, preview: 'new' })]
	const stale = [base({ revision: 1, preview: 'old' })]
	const merged = mergeSnapshotCanvases(current, stale)
	assert.equal(merged[0].preview, 'new')
	assert.equal(merged[0].revision, 2)
})

test('preview-free snapshots keep the existing preview', () => {
	const current = [base({ revision: 2, preview: 'new' })]
	const light = [base({ revision: 2, updatedAt: '2026-01-01T00:00:01.000Z', preview: undefined })]
	const merged = mergeSnapshotCanvases(current, light)
	assert.equal(merged[0].preview, 'new')
	assert.equal(merged[0].updatedAt, '2026-01-01T00:00:01.000Z')
})

test('a metadata snapshot can rename a canvas with the same revision', () => {
	const current = [base()]
	const renamed = [base({ name: 'Renamed', preview: 'old' })]
	const merged = mergeSnapshotCanvases(current, renamed)
	assert.equal(merged[0].name, 'Renamed')
})

test('a delayed board summary cannot roll back a name or a newer preview', () => {
	const current = [
		base({ revision: 2, name: 'Renamed', preview: 'new', updatedAt: '2026-01-01T00:00:01.000Z' }),
	]
	const delayed = [base({ revision: 1, name: 'Old name', preview: 'old' })]
	const merged = upsertCanvasSummary(current, delayed[0])
	assert.equal(merged[0].name, 'Renamed')
	assert.equal(merged[0].preview, 'new')
	assert.equal(merged[0].revision, 2)
})

test('a board summary updates content but preserves the current name', () => {
	const current = [base({ name: 'Renamed', preview: 'old' })]
	const next = base({
		revision: 2,
		name: 'Stale name',
		preview: 'new',
		updatedAt: '2026-01-01T00:00:02.000Z',
	})
	const merged = upsertCanvasSummary(current, next)
	assert.equal(merged[0].name, 'Renamed')
	assert.equal(merged[0].preview, 'new')
	assert.equal(merged[0].revision, 2)
})

test('the board cache never moves backwards', () => {
	const cache = new Map()
	rememberBoard(cache, 'canvas', { revision: 2, shapes: [] })
	rememberBoard(cache, 'canvas', { revision: 1, shapes: [] })
	assert.equal(cache.get('canvas')?.revision, 2)
})
