import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dockLeft, FRAME_LAYOUT } from './frame/layout.ts'

test('frame metrics follow the four-pixel spacing contract', () => {
	assert.deepEqual(FRAME_LAYOUT, {
		grid: 4,
		desktopInset: 24,
		mobileInset: 16,
		mobileBreakpoint: 768,
		controlSize: 40,
		iconSize: 20,
	})
	for (const value of [
		FRAME_LAYOUT.desktopInset,
		FRAME_LAYOUT.mobileInset,
		FRAME_LAYOUT.controlSize,
		FRAME_LAYOUT.iconSize,
	]) {
		assert.equal(value % FRAME_LAYOUT.grid, 0)
	}
})

test('dock placement centers and aligns to the frame grid', () => {
	assert.equal(dockLeft(1440, 800), 320)
	assert.equal(dockLeft(1001, 502), 248)
	assert.equal(dockLeft(320, 320), 0)
	assert.equal(dockLeft(301, 320), -8)
})
