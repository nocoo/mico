import assert from 'node:assert/strict'
import test from 'node:test'
import type { Board } from '../shared/types.ts'
import { boardDigest, digestShape } from './aiBoard.ts'

test('action digest previews are bounded while explicit inspection is complete', () => {
	const items = Array.from({ length: 200 }, (_, index) => ({
		id: `action-${index}`,
		text: `${index}:`.padEnd(6000, '界'),
		done: index % 2 === 0,
	}))
	const board: Board = {
		revision: 4,
		shapes: [
			{
				id: 'actions',
				type: 'actions',
				x: 0,
				y: 0,
				w: 300,
				h: 200,
				color: '#f1fadc',
				title: 'Actions',
				items,
			},
		],
	}

	const preview = digestShape(board.shapes[0])
	assert.equal(preview.itemCount, 200)
	assert.equal(preview.items?.length, 3)
	assert.ok(preview.items?.every((item) => item.text.length <= 180))
	assert.equal(JSON.stringify(preview).length < 2000, true)

	const digest = boardDigest(board, [])
	assert.equal(digest.shapes[0].itemCount, 200)
	assert.equal(digest.shapes[0].items?.length, 3)

	const inspected = boardDigest(board, [], { ids: ['actions'] })
	assert.equal(inspected.shapes[0].itemCount, 200)
	assert.equal(inspected.shapes[0].items?.length, 200)
	inspected.shapes[0].items?.forEach((item, index) => {
		assert.equal(item.id, items[index].id)
		assert.equal(item.text, items[index].text)
		assert.equal(item.done, items[index].done)
	})
})
