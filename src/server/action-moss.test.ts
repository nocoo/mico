import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { serializeCanvasTools } from './mossApi.ts'
import { BoardStore, LOCAL_TENANT } from './store.ts'

test('MOSS serializes action-card tool without a completion field', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-action-moss-'))
	const board = new BoardStore(join(directory, 'board.sqlite'))
	const store = board.forTenant(LOCAL_TENANT)
	try {
		const tools = await serializeCanvasTools(
			store,
			() => {},
			await store.getActiveCanvasId(),
			[],
			0,
		)
		const actionCard = tools.find((tool) => tool.name === 'upsert_action_card')
		assert.ok(actionCard)
		const schema = actionCard.parameters as {
			properties: {
				items: { items: { properties: Record<string, unknown> } }
				removeItemIds: unknown
			}
		}
		assert.equal(Object.hasOwn(schema.properties.items.items.properties, 'done'), false)
		assert.ok(schema.properties.removeItemIds)
	} finally {
		await board.close()
		rmSync(directory, { recursive: true, force: true })
	}
})
