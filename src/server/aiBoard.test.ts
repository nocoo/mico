import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Board } from '../shared/types.ts'
import { boardDigest, formatBoardContext } from './aiBoard.ts'

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
				id: 'actions',
				type: 'actions',
				x: 300,
				y: 200,
				w: 300,
				h: 300,
				color: '#f1fadc',
				title: 'Actions',
				items: [{ id: 'stable-action', text: 'Detailed action '.repeat(30), done: true }],
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
	assert.equal(context.shapes[1].itemCount, 1)
	assert.equal(context.shapes[1].items?.[0].id, 'stable-action')
	assert.equal(context.shapes[1].items?.[0].text.length, 180)
	assert.equal(context.shapes[2].html, undefined)
	assert.equal(
		context.warnings.some((warning) => warning.includes('very large')),
		false,
	)
	const inspected = boardDigest(board, [], {
		ids: ['note', 'actions', 'summary'],
		includeHtml: true,
	})
	assert.equal(inspected.shapes[0].text, text)
	assert.equal(inspected.shapes[1].items?.[0].text, 'Detailed action '.repeat(30))
	assert.equal(inspected.shapes[1].items?.[0].done, true)
	assert.equal(inspected.shapes[2].html, html)
})

test('anchor-preserving digest retains structural anchors at 180 shapes with compact context', () => {
	const shapes: Board['shapes'] = [
		{
			id: 'meeting-title',
			type: 'text',
			x: 80,
			y: 144,
			w: 420,
			h: 64,
			color: '#2b3038',
			text: 'Q3 Quarterly Product Review',
			fontSize: 48,
		},
		{
			id: 'topic-frame-1',
			type: 'frame',
			x: 40,
			y: 240,
			w: 1400,
			h: 520,
			color: '#00a2e1',
			title: 'Topic 1: Core Growth Metrics',
		},
		{
			id: 'topic-card-1',
			type: 'html',
			x: 1620,
			y: 260,
			w: 960,
			h: 620,
			color: '#00a2e1',
			title: 'Topic 1 Summary',
			html: '<main class="mico-report"><h1>Topic 1</h1></main>',
		},
		{
			id: 'actions-main',
			type: 'actions',
			x: 2720,
			y: 260,
			w: 320,
			h: 220,
			color: '#f1fadc',
			title: 'Actions',
			items: [{ id: 'a-1', text: 'Follow up on landing page', done: false }],
		},
	]
	for (let index = shapes.length; index < 180; index++) {
		shapes.push({
			id: `item-${index}`,
			type: index % 2 === 0 ? 'note' : 'rectangle',
			x: 80 + (index % 4) * 320,
			y: 280 + Math.floor(index / 4) * 140,
			w: 240,
			h: 110,
			color: index % 2 === 0 ? '#e2f5fc' : '#00a2e1',
			text: `Fact or node ${index}: detailed metric value ${index * 3}%`,
		})
	}
	const context = formatBoardContext({ revision: 180, shapes }, [])
	for (const anchorId of ['meeting-title', 'topic-frame-1', 'topic-card-1', 'actions-main']) {
		assert.ok(context.includes(anchorId), `Missing structural anchor ${anchorId}`)
	}
	assert.ok(
		Buffer.byteLength(context) < 15_000,
		`Expected compact board context < 15000 bytes, got ${Buffer.byteLength(context)}`,
	)
})
