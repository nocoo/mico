import assert from 'node:assert/strict'
import { test } from 'node:test'
import type React from 'react'
import { CANDY_COLORS, CANDY_TINTS } from '../shared/palette.ts'
import { JELLY_COLORS, jellyStyle } from './canvas/jelly.ts'

const sky = jellyStyle(CANDY_TINTS.blue)
const variable = (style: React.CSSProperties, name: `--j-${string}`) =>
	(style as Record<string, string>)[name]

for (const color of [CANDY_COLORS.blue, CANDY_TINTS.blue]) {
	test(`${color} uses the reference sky family`, () => {
		assert.deepEqual(jellyStyle(color), sky)
		assert.equal(
			variable(sky, '--j-a'),
			'light-dark(oklch(0.968 calc(.085 * .5) 236 / .92), oklch(0.42 calc(.085 * .95) 236 / .82))',
		)
	})
}

for (const [preset, tint, hue, chroma] of [
	[CANDY_COLORS.green, CANDY_TINTS.green, 166, '.095'],
	[CANDY_COLORS.yellow, CANDY_TINTS.yellow, 98, '.12'],
	[CANDY_COLORS.pink, CANDY_TINTS.pink, 8, '.1'],
] as const) {
	test(`${preset} and its tint use the reference hue and chroma`, () => {
		const style = jellyStyle(preset)
		assert.deepEqual(jellyStyle(tint), style)
		assert.match(variable(style, '--j-b'), new RegExp(`${hue} /`))
		assert.match(variable(style, '--j-b'), new RegExp(`^.*${chroma} ${hue}`))
	})
}

test('peach and grape use the remaining reference color families', () => {
	assert.match(variable(jellyStyle(JELLY_COLORS.peach), '--j-b'), /\.105 55/)
	assert.match(variable(jellyStyle(JELLY_COLORS.grape), '--j-b'), /\.1 296/)
})

test('custom colors retain their exact edge identity and use relative jelly fills', () => {
	for (const color of ['#123456', '#ABCDEF', '#000000', '#ffffff']) {
		const style = jellyStyle(color)
		assert.equal(variable(style, '--j-edge'), color)
		assert.match(variable(style, '--j-a'), new RegExp(`oklch\\(from ${color}`))
		assert.match(variable(style, '--j-a'), /l \* \.07/)
	}
})

test('neutral jelly fills preserve enough source lightness to distinguish black and white', () => {
	for (const name of ['--j-a', '--j-b'] as const) {
		const black = variable(jellyStyle('#000000'), name)
		const white = variable(jellyStyle('#ffffff'), name)
		assert.notEqual(black, white)
		assert.match(black, /l \*/)
		assert.match(white, /l \*/)
	}
})

test('neutral and ink remain custom colors instead of inventing a reference family', () => {
	for (const color of [CANDY_TINTS.neutral, CANDY_COLORS.ink]) {
		assert.match(variable(jellyStyle(color), '--j-b'), new RegExp(color))
	}
})

test('mapped presets are case-insensitive without rewriting the stored color', () => {
	assert.deepEqual(jellyStyle(CANDY_TINTS.yellow.toUpperCase()), jellyStyle(CANDY_TINTS.yellow))
})
