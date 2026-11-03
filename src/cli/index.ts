import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const usage = `Usage:
  mico board get
  mico shape create '<shape JSON>'
  mico shape update <id> '<patch JSON>'
  mico shape delete <id>
  mico batch <file|->

Batch accepts a JSON array of operations or {"operations": [...]}.
Use - to read the batch from stdin.`

function parseObject(value: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(value)
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('Expected a JSON object')
	}
	return parsed as Record<string, unknown>
}

async function readStdin(): Promise<string> {
	let input = ''
	for await (const chunk of process.stdin) input += chunk
	return input
}

async function main(args: string[]) {
	if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
		console.log(usage)
		return
	}

	const port = process.env.MICO_PORT ?? '4318'
	if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
		throw new Error('MICO_PORT must be a valid port number')
	}

	let path: string
	let request: RequestInit
	if (args.length === 2 && args[0] === 'board' && args[1] === 'get') {
		path = '/api/board'
		request = {}
	} else {
		let body: unknown
		if (args.length === 3 && args[0] === 'shape' && args[1] === 'create') {
			const shape = parseObject(args[2])
			body = { operations: [{ type: 'create', shape: { ...shape, id: shape.id ?? randomUUID() } }] }
		} else if (args.length === 4 && args[0] === 'shape' && args[1] === 'update') {
			body = { operations: [{ type: 'update', id: args[2], patch: parseObject(args[3]) }] }
		} else if (args.length === 3 && args[0] === 'shape' && args[1] === 'delete') {
			body = { operations: [{ type: 'delete', id: args[2] }] }
		} else if (args.length === 2 && args[0] === 'batch') {
			const input: unknown = JSON.parse(
				args[1] === '-' ? await readStdin() : await readFile(args[1], 'utf8'),
			)
			body = Array.isArray(input) ? { operations: input } : input
		} else {
			throw new Error(usage)
		}
		path = '/api/operations'
		request = {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}
	}

	const response = await fetch(`http://127.0.0.1:${port}${path}`, request)
	const result: unknown = await response.json()
	if (!response.ok) throw new Error(JSON.stringify(result))
	console.log(JSON.stringify(result, null, 2))
}

main(process.argv.slice(2)).catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
