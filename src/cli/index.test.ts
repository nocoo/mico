import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'

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
	const [code] = await once(child, 'close')
	return { code, stdout, stderr }
}

test('CLI reads the board, creates shapes, and sends batches', async () => {
	const received: unknown[] = []
	const server = createServer(async (request, response) => {
		if (request.url === '/api/board') {
			response
				.writeHead(200, { 'Content-Type': 'application/json' })
				.end('{"revision":0,"shapes":[]}')
			return
		}
		let body = ''
		for await (const chunk of request) body += chunk
		received.push(JSON.parse(body))
		response
			.writeHead(200, { 'Content-Type': 'application/json' })
			.end('{"revision":1,"shapes":[]}')
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	try {
		const board = await runCli(address.port, ['board', 'get'])
		assert.equal(board.code, 0)
		assert.deepEqual(JSON.parse(board.stdout), { revision: 0, shapes: [] })

		const created = await runCli(address.port, ['shape', 'create', '{"type":"rectangle"}'])
		assert.equal(created.code, 0)
		const body = received[0] as { operations: Array<{ shape: { id: string; type: string } }> }
		assert.match(body.operations[0].shape.id, /^[0-9a-f-]{36}$/)
		assert.equal(body.operations[0].shape.type, 'rectangle')

		const batch = await runCli(address.port, ['batch', '-'], '[{"type":"delete","id":"test"}]')
		assert.equal(batch.code, 0)
		assert.deepEqual(received[1], { operations: [{ type: 'delete', id: 'test' }] })

		const invalid = await runCli(address.port, ['shape', 'create', '[]'])
		assert.equal(invalid.code, 1)
		assert.match(invalid.stderr, /Expected a JSON object/)
	} finally {
		server.close()
	}
})
