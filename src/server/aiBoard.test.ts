import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Board } from '../shared/types.ts'
import { boardDigest } from './aiBoard.ts'

test('explicit object inspection returns complete text and HTML for safe updates', () => {
	const text = '交接'.repeat(200)
	const html = `<div>${'detail'.repeat(9000)}</div>`
	const board: Board = {
		revision: 1,
		shapes: [
			{
				id: 'note',
				type: 'note',
				x: 0,
				y: 0,
				w: 200,
				h: 200,
				color: '#fff8d4',
				label: 'Risk',
				text,
			},
			{
				id: 'summary',
				type: 'html',
				x: 5000,
				y: 3000,
				w: 1200,
				h: 800,
				color: '#00a2e1',
				title: 'Summary',
				html,
			},
		],
	}
	const context = boardDigest(board, [])
	assert.notEqual(context.shapes[0].text, text)
	assert.equal(context.shapes[0].label, 'Risk')
	assert.equal(context.shapes[1].html, undefined)
	assert.equal(
		context.warnings.some((warning) => warning.includes('very large')),
		false,
	)
	const inspected = boardDigest(board, [], { ids: ['note', 'summary'], includeHtml: true })
	assert.equal(inspected.shapes[0].text, text)
	assert.equal(inspected.shapes[1].html, html)
})
