import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	CANDY_COLORS,
	CANDY_LAYOUT,
	CANDY_TINTS,
	candyInk,
	candyWash,
	NOTE_COLORS,
	SHAPE_COLORS,
} from './design.ts'

test('the candy palette is vivid for surfaces and readable for text', () => {
	assert.deepEqual(
		SHAPE_COLORS.map(({ value }) => value),
		[
			CANDY_COLORS.blue,
			CANDY_COLORS.green,
			CANDY_COLORS.yellow,
			CANDY_COLORS.pink,
			CANDY_COLORS.ink,
		],
	)
	assert.deepEqual(
		NOTE_COLORS.map(({ value }) => value),
		[
			CANDY_TINTS.yellow,
			CANDY_TINTS.pink,
			CANDY_TINTS.green,
			CANDY_TINTS.blue,
			CANDY_TINTS.neutral,
		],
	)
	assert.equal(candyInk(CANDY_COLORS.blue), CANDY_LAYOUT.blueStroke)
	assert.equal(candyInk(CANDY_COLORS.green), CANDY_LAYOUT.greenStroke)
	assert.equal(candyInk(CANDY_COLORS.yellow), CANDY_LAYOUT.yellowStroke)
	assert.equal(candyInk(CANDY_COLORS.pink), CANDY_LAYOUT.pinkStroke)
	assert.equal(candyInk(CANDY_COLORS.ink), CANDY_COLORS.ink)
	assert.equal(candyInk('#123456'), '#123456')
})

test('pale washes derive from the shared surface token', () => {
	assert.equal(candyWash(CANDY_COLORS.blue), 'color-mix(in srgb, #00a2e1 10%, var(--surface))')
	assert.equal(candyWash(CANDY_COLORS.pink, 5), 'color-mix(in srgb, #ff7fa3 5%, var(--surface))')
})
