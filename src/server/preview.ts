import { Buffer } from 'node:buffer'
import { overviewProjection } from '../shared/overview.ts'
import { FRAME_FILL_PERCENT } from '../shared/palette.ts'
import type { Shape } from '../shared/types.ts'
import { CANDY_LAYOUT } from '../web/design.ts'

export const PREVIEW_WIDTH = 160
export const PREVIEW_HEIGHT = 100

const PADDING = 8
const MAX_SCALE = 1.5

function escapeXml(value: string): string {
	let safe = ''
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0
		if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue
		if (code === 0xfffe || code === 0xffff) continue
		safe += character
	}
	return safe
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}

export function canvasPreview(shapes: Shape[]): string {
	const projection = overviewProjection(shapes, {
		width: PREVIEW_WIDTH,
		height: PREVIEW_HEIGHT,
		padding: PADDING,
		maxScale: MAX_SCALE,
	})
	const content = projection.blocks
		.map((block) => {
			const color = escapeXml(block.color)
			if (block.type === 'ellipse') {
				return `<ellipse cx="${block.projectedX + block.projectedWidth / 2}" cy="${block.projectedY + block.projectedHeight / 2}" rx="${block.projectedWidth / 2}" ry="${block.projectedHeight / 2}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="1.5"/>`
			}
			const frame = block.type === 'frame'
			return `<rect x="${block.projectedX}" y="${block.projectedY}" width="${block.projectedWidth}" height="${block.projectedHeight}" rx="${frame ? 4 : 3}" fill="${color}" fill-opacity="${frame ? FRAME_FILL_PERCENT / 100 : 0.22}" stroke="${color}" stroke-opacity="${frame ? 0.45 : 0.85}"/>`
		})
		.join('')
	const background = `<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="${CANDY_LAYOUT.canvas}"/>`
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">${background}<rect x="0.5" y="0.5" width="${PREVIEW_WIDTH - 1}" height="${PREVIEW_HEIGHT - 1}" rx="6" fill="none" stroke="${CANDY_LAYOUT.border}"/>${content}</svg>`
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
