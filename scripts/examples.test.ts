import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { BoardStore, LOCAL_TENANT, OperationError } from '../src/server/store.ts'
import type { Board, Shape } from '../src/shared/types.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

async function runExample(file: string): Promise<unknown[]> {
	const child = spawn(process.execPath, [file], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
	let stdout = ''
	let stderr = ''
	child.stdout.setEncoding('utf8').on('data', (data: string) => {
		stdout += data
	})
	child.stderr.setEncoding('utf8').on('data', (data: string) => {
		stderr += data
	})
	try {
		const [code] = await once(child, 'close', { signal: AbortSignal.timeout(20_000) })
		assert.equal(code, 0, stderr)
	} finally {
		if (child.exitCode === null) child.kill('SIGKILL')
	}
	const parsed: unknown = JSON.parse(stdout)
	assert.ok(Array.isArray(parsed))
	return parsed
}

function readJsonExample(file: string): unknown[] {
	const parsed: unknown = JSON.parse(readFileSync(join(root, file), 'utf8'))
	assert.ok(Array.isArray(parsed), `${file} must be an operation array`)
	return parsed
}

async function applyExample(
	operations: unknown[],
): Promise<{ board: Board; close: () => Promise<void> }> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-example-'))
	const boardStore = new BoardStore(join(directory, 'board.sqlite'))
	const store = boardStore.forTenant(LOCAL_TENANT)
	try {
		const board = await store.apply({ operations })
		return {
			board,
			close: async () => {
				await boardStore.close()
				rmSync(directory, { recursive: true, force: true })
			},
		}
	} catch (error) {
		await boardStore.close()
		rmSync(directory, { recursive: true, force: true })
		throw error
	}
}

async function assertExample(operations: unknown[], check: (board: Board) => void): Promise<void> {
	const applied = await applyExample(operations)
	try {
		check(applied.board)
	} finally {
		await applied.close()
	}
	const directory = mkdtempSync(join(tmpdir(), 'mico-example-'))
	const board = new BoardStore(join(directory, 'board.sqlite'))
	const store = board.forTenant(LOCAL_TENANT)
	try {
		await store.apply({ operations })
		await assert.rejects(
			async () => await store.apply({ operations }),
			(error: unknown) =>
				error instanceof OperationError && error.code === 'DUPLICATE_ID' && error.status === 400,
			'fixed example ids must fail explicitly on a second application',
		)
	} finally {
		await board.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

const count = (board: Board, type: Shape['type']) =>
	board.shapes.filter((shape) => shape.type === type).length

test('JSON example batches apply through the validated store', async () => {
	const architecture = readJsonExample('examples/architecture.json')
	await assertExample(architecture, (board) => {
		assert.ok(board.shapes.length >= 5)
		assert.ok(count(board, 'connector') > 0)
		assert.ok(count(board, 'rectangle') > 0)
	})

	const canvasMap = readJsonExample('examples/agent-canvas-map.json')
	await assertExample(canvasMap, (board) => {
		assert.equal(board.shapes.length, 34)
		assert.ok(count(board, 'text') > 0)
		assert.ok(count(board, 'ellipse') > 0)
		assert.ok(count(board, 'connector') > 0)
	})
})

test('agent TypeScript examples print operations accepted by the store', async () => {
	const sketch = await runExample('examples/sketch.ts')
	await assertExample(sketch, (board) => {
		assert.equal(count(board, 'path'), 23)
		assert.equal(count(board, 'text'), 1)
		for (const shape of board.shapes) {
			if (shape.type !== 'path') continue
			const points = shape.points ?? []
			assert.ok(points.length >= 2)
			for (const point of points) {
				assert.ok(point.x >= 0 && point.x <= shape.w)
				assert.ok(point.y >= 0 && point.y <= shape.h)
			}
		}
	})

	const distributed = await runExample('examples/distributed-architecture.ts')
	await assertExample(distributed, (board) => {
		assert.equal(board.shapes.length, 53)
		assert.equal(count(board, 'connector'), 27)
		assert.equal(count(board, 'ellipse'), 4)
		assert.equal(count(board, 'rectangle'), 16)
	})
})

test('frame and html agent example exercises the current API contract', async () => {
	const dashboard = await runExample('examples/frame-dashboard.ts')
	await assertExample(dashboard, (board) => {
		assert.equal(board.shapes.length, 8)
		assert.equal(count(board, 'frame'), 2)
		assert.equal(count(board, 'html'), 1)
		const members = board.shapes
			.filter((shape) => shape.type !== 'connector' && shape.frameId === 'dashboard-frame-a')
			.map((shape) => shape.id)
			.sort()
		assert.deepEqual(members, [
			'dashboard-html',
			'dashboard-note',
			'dashboard-summary',
			'dashboard-title',
		])
		const html = board.shapes.find((shape) => shape.id === 'dashboard-html')
		assert.equal(html?.type, 'html')
		assert.match((html?.type === 'html' ? html.html : '') ?? '', /Weekly active agents/)
		const connectors = board.shapes.filter((shape) => shape.type === 'connector')
		assert.deepEqual(
			connectors.map((shape) => [shape.from, shape.to]),
			[
				['dashboard-frame-a', 'dashboard-frame-b'],
				['dashboard-summary', 'dashboard-note'],
			],
		)
	})
})
