import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDaemon, type Daemon } from '../server/index.ts'
import type { Board, CanvasShape } from '../shared/types.ts'

const CLI_TIMEOUT_MS = 15_000

async function runCli(port: number, args: string[], input?: string) {
	const child = spawn(process.execPath, ['src/cli/index.ts', ...args], {
		env: { ...process.env, MICO_PORT: String(port) },
		stdio: ['pipe', 'pipe', 'pipe'],
	})
	let stdout = ''
	let stderr = ''
	child.stdout.setEncoding('utf8').on('data', (data: string) => {
		stdout += data
	})
	child.stderr.setEncoding('utf8').on('data', (data: string) => {
		stderr += data
	})
	child.stdin.end(input)
	try {
		const [code] = await once(child, 'close', {
			signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
		})
		return { code, stdout, stderr }
	} finally {
		if (child.exitCode === null) child.kill('SIGKILL')
	}
}

async function withDaemon(run: (port: number, directory: string) => Promise<void>) {
	const directory = mkdtempSync(join(tmpdir(), 'mico-cli-'))
	let daemon: Daemon | undefined
	try {
		daemon = createDaemon({ port: 0, dbPath: join(directory, 'board.sqlite') })
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		await run(address.port, directory)
	} finally {
		if (daemon) {
			for (const client of daemon.wss.clients) client.terminate()
			daemon.close()
		}
		rmSync(directory, { recursive: true, force: true })
	}
}

async function closedPort(): Promise<number> {
	const server = createServer()
	server.listen(0, '127.0.0.1')
	await once(server, 'listening', { signal: AbortSignal.timeout(5000) })
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	const { port } = address
	await new Promise<void>((resolve) => server.close(() => resolve()))
	return port
}

function boardOf(output: string): Board {
	return JSON.parse(output) as Board
}

test('CLI drives the real daemon with create, update, delete and batches', async () => {
	await withDaemon(async (port, directory) => {
		const empty = await runCli(port, ['board', 'get'])
		assert.equal(empty.code, 0)
		assert.deepEqual(boardOf(empty.stdout), { revision: 0, shapes: [] })

		const created = await runCli(port, [
			'shape',
			'create',
			JSON.stringify({
				id: 'cli-rect',
				type: 'rectangle',
				x: 40,
				y: 60,
				w: 200,
				h: 80,
				color: '#5b5fc7',
				text: 'From CLI',
			}),
		])
		assert.equal(created.code, 0)
		assert.equal((boardOf(created.stdout).shapes[0] as CanvasShape).id, 'cli-rect')

		const generated = await runCli(port, [
			'shape',
			'create',
			JSON.stringify({ type: 'ellipse', x: 300, y: 60, w: 80, h: 80, color: '#22c55e' }),
		])
		assert.equal(generated.code, 0)
		const generatedShape = boardOf(generated.stdout).shapes.at(-1) as CanvasShape
		assert.match(generatedShape.id, /^[0-9a-f-]{36}$/)

		const updated = await runCli(port, ['shape', 'update', 'cli-rect', '{"text":"Renamed"}'])
		assert.equal(updated.code, 0)
		const renamed = boardOf(updated.stdout).shapes.find((shape) => shape.id === 'cli-rect')
		assert.equal(renamed?.type === 'rectangle' ? renamed.text : undefined, 'Renamed')

		const deleted = await runCli(port, ['shape', 'delete', 'cli-rect'])
		assert.equal(deleted.code, 0)
		assert.ok(!boardOf(deleted.stdout).shapes.some((shape) => shape.id === 'cli-rect'))

		const stdinBatch = await runCli(
			port,
			['batch', '-'],
			JSON.stringify([
				{
					type: 'create',
					shape: {
						id: 'cli-frame',
						type: 'frame',
						x: 600,
						y: 100,
						w: 520,
						h: 360,
						color: '#3b82f6',
						title: 'CLI frame',
					},
				},
				{
					type: 'create',
					shape: {
						id: 'cli-html',
						type: 'html',
						x: 640,
						y: 180,
						w: 440,
						h: 240,
						color: '#22c55e',
						title: 'CLI html',
						html: '<p id="value">7</p>',
						frameId: 'cli-frame',
					},
				},
				{
					type: 'create',
					shape: {
						id: 'cli-note',
						type: 'note',
						x: 660,
						y: 440,
						w: 120,
						h: 120,
						color: '#fef3c7',
						text: 'Member',
						frameId: 'cli-frame',
					},
				},
			]),
		)
		assert.equal(stdinBatch.code, 0)
		const batchBoard = boardOf(stdinBatch.stdout)
		assert.deepEqual(
			batchBoard.shapes
				.filter((shape) => shape.type !== 'connector' && shape.frameId === 'cli-frame')
				.map((shape) => shape.id)
				.sort(),
			['cli-html', 'cli-note'],
		)

		const file = join(directory, 'update.json')
		writeFileSync(
			file,
			JSON.stringify({
				operations: [{ type: 'update', id: 'cli-html', patch: { html: '<p>8</p>' } }],
			}),
		)
		const fileBatch = await runCli(port, ['batch', file])
		assert.equal(fileBatch.code, 0)
		assert.equal(
			(boardOf(fileBatch.stdout).shapes.find((shape) => shape.id === 'cli-html') as CanvasShape)
				.html,
			'<p>8</p>',
		)

		const conflict = await runCli(
			port,
			['batch', '-'],
			JSON.stringify({
				expectedRevision: 0,
				operations: [{ type: 'update', id: 'cli-html', patch: { title: 'Outdated' } }],
			}),
		)
		assert.equal(conflict.code, 1)
		assert.match(conflict.stderr, /REVISION_CONFLICT/)
	})
})

test('CLI reports usage, invalid input and unreachable daemons', async () => {
	await withDaemon(async (port, directory) => {
		const usage = await runCli(port, [])
		assert.equal(usage.code, 0)
		assert.match(usage.stdout, /Usage:/)

		const invalidJson = await runCli(port, ['shape', 'create', '{'])
		assert.equal(invalidJson.code, 1)
		assert.match(invalidJson.stderr, /JSON/)

		const notObject = await runCli(port, ['shape', 'create', '[]'])
		assert.equal(notObject.code, 1)
		assert.match(notObject.stderr, /Expected a JSON object/)

		const image = await runCli(port, ['shape', 'create', '{"type":"image"}'])
		assert.equal(image.code, 1)
		assert.match(image.stderr, /INVALID_REQUEST/)

		const unknown = await runCli(port, ['board', 'set'])
		assert.equal(unknown.code, 1)
		assert.match(unknown.stderr, /Usage:/)

		const invalidPort = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
			const child = spawn(process.execPath, ['src/cli/index.ts', 'board', 'get'], {
				env: { ...process.env, MICO_PORT: 'not-a-port' },
				stdio: ['ignore', 'ignore', 'pipe'],
			})
			let stderr = ''
			child.stderr.setEncoding('utf8').on('data', (data: string) => {
				stderr += data
			})
			const timer = setTimeout(() => child.kill('SIGKILL'), CLI_TIMEOUT_MS)
			child.on('close', (code) => {
				clearTimeout(timer)
				resolve({ code, stderr })
			})
		})
		assert.equal(invalidPort.code, 1)
		assert.match(invalidPort.stderr, /MICO_PORT/)

		const unreachable = await runCli(await closedPort(), ['board', 'get'])
		assert.equal(unreachable.code, 1)
		assert.ok(unreachable.stderr.length > 0)

		const file = join(directory, 'missing.json')
		const missingFile = await runCli(port, ['batch', file])
		assert.equal(missingFile.code, 1)
	})
})
