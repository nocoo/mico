import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JELLY_COLORS } from './canvas/jelly.ts'
import {
	adaptiveCanvasTextColor,
	adaptiveInkEdge,
	adaptiveJellyStyle,
	CANDY_COLORS,
	CANDY_LAYOUT,
	CANDY_TINTS,
	candyInk,
	candyLine,
	candyWash,
	canvasTextColor,
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
			JELLY_COLORS.peach,
			JELLY_COLORS.grape,
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
			JELLY_COLORS.peach,
			JELLY_COLORS.grape,
			CANDY_TINTS.neutral,
		],
	)
	assert.equal(candyInk(CANDY_COLORS.blue), CANDY_LAYOUT.blueStroke)
	assert.equal(candyInk(CANDY_COLORS.green), CANDY_LAYOUT.greenStroke)
	assert.equal(candyInk(CANDY_COLORS.yellow), CANDY_LAYOUT.yellowStroke)
	assert.equal(candyInk(CANDY_COLORS.pink), CANDY_LAYOUT.pinkStroke)
	assert.equal(candyInk(CANDY_COLORS.ink), CANDY_COLORS.ink)
	assert.equal(candyInk('#123456'), '#123456')
	assert.equal(canvasTextColor(CANDY_COLORS.ink), 'var(--ui-ink)')
	assert.equal(canvasTextColor(CANDY_COLORS.blue), CANDY_LAYOUT.blueStroke)
	assert.equal(canvasTextColor('#123456'), '#123456')
})

test('pale washes derive from the shared surface token', () => {
	assert.equal(candyWash(CANDY_COLORS.blue), 'color-mix(in srgb, #00a2e1 10%, var(--surface))')
	assert.equal(candyWash(CANDY_COLORS.pink, 5), 'color-mix(in srgb, #ff7fa3 5%, var(--surface))')
	assert.equal(candyLine(CANDY_COLORS.blue), 'color-mix(in srgb, #00a2e1 35%, var(--border))')
})

test('adaptive canvas color helpers handle light/dark tokens and ink edges', () => {
	assert.equal(adaptiveCanvasTextColor(CANDY_COLORS.ink), 'var(--ui-ink)')
	assert.match(adaptiveCanvasTextColor(CANDY_COLORS.blue), /^light-dark\(/)
	assert.match(adaptiveCanvasTextColor(CANDY_COLORS.green), /^light-dark\(/)
	assert.match(adaptiveCanvasTextColor(CANDY_COLORS.yellow), /^light-dark\(/)
	assert.match(adaptiveCanvasTextColor(CANDY_COLORS.pink), /^light-dark\(/)
	assert.equal(adaptiveCanvasTextColor('#123456'), '#123456')

	assert.match(adaptiveInkEdge(CANDY_COLORS.ink) ?? '', /^light-dark\(/)
	assert.equal(adaptiveInkEdge(CANDY_COLORS.blue), undefined)
	const inkJelly = adaptiveJellyStyle(CANDY_COLORS.ink) as Record<string, string>
	const blueJelly = adaptiveJellyStyle(CANDY_COLORS.blue) as Record<string, string>
	assert.equal(inkJelly['--j-edge'], adaptiveInkEdge(CANDY_COLORS.ink))
	assert.notEqual(blueJelly['--j-edge'], adaptiveInkEdge(CANDY_COLORS.ink))
})
