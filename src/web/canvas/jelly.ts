import type React from 'react'
import { CANDY_COLORS, CANDY_TINTS } from '../../shared/palette.ts'

type JellyFamily = readonly [hue: number, chroma: string]
type JellyProperties = React.CSSProperties & Record<`--j-${string}`, string>

export const JELLY_COLORS = { peach: '#f69143', grape: '#b799ff' } as const

function familyStyle([hue, chroma]: JellyFamily): JellyProperties {
	return {
		'--j-a': `light-dark(oklch(0.968 calc(${chroma} * .5) ${hue} / .92), oklch(0.42 calc(${chroma} * .95) ${hue} / .82))`,
		'--j-b': `light-dark(oklch(0.9 ${chroma} ${hue} / .92), oklch(0.31 ${chroma} ${hue} / .86))`,
		'--j-edge': `light-dark(oklch(0.75 calc(${chroma} * 1.45) ${hue}), oklch(0.72 calc(${chroma} * 1.35) ${hue}))`,
		'--j-ink': `light-dark(oklch(0.35 calc(${chroma} * .95) ${hue}), oklch(0.95 calc(${chroma} * .45) ${hue}))`,
		'--j-glow': `light-dark(oklch(0.7 calc(${chroma} * 1.5) ${hue} / .45), oklch(0.62 calc(${chroma} * 1.5) ${hue} / .34))`,
	}
}

const SKY = familyStyle([236, '.085'])
const MINT = familyStyle([166, '.095'])
const LEMON = familyStyle([98, '.12'])
const PINK = familyStyle([8, '.1'])
const PEACH = familyStyle([55, '.105'])
const GRAPE = familyStyle([296, '.1'])

const FAMILIES = new Map<string, JellyProperties>([
	[CANDY_COLORS.blue, SKY],
	[CANDY_TINTS.blue, SKY],
	[CANDY_COLORS.green, MINT],
	[CANDY_TINTS.green, MINT],
	[CANDY_COLORS.yellow, LEMON],
	[CANDY_TINTS.yellow, LEMON],
	[CANDY_COLORS.pink, PINK],
	[CANDY_TINTS.pink, PINK],
	[JELLY_COLORS.peach, PEACH],
	[JELLY_COLORS.grape, GRAPE],
])

function relativeStyle(color: string): JellyProperties {
	return {
		'--j-a': `light-dark(oklch(from ${color} calc(.93 + l * .07) calc(c * .5) h / .92), oklch(from ${color} calc(.3 + l * .15) calc(c * .95) h / .82))`,
		'--j-b': `light-dark(oklch(from ${color} calc(.84 + l * .1) c h / .92), oklch(from ${color} calc(.2 + l * .15) c h / .86))`,
		'--j-edge': color,
		'--j-ink': `light-dark(oklch(from ${color} 0.35 calc(c * .95) h), oklch(from ${color} 0.95 calc(c * .45) h))`,
		'--j-glow': `light-dark(oklch(from ${color} 0.7 calc(c * 1.5) h / .45), oklch(from ${color} 0.62 calc(c * 1.5) h / .34))`,
	}
}

export function jellyStyle(color: string): React.CSSProperties {
	const preset = FAMILIES.get(color.toLowerCase())
	return preset ? { ...preset } : relativeStyle(color)
}
