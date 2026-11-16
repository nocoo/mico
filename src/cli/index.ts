import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DAEMON_PORT } from '../shared/config.ts'

const usage = `Usage:
  mico canvas list [--preview]
  mico canvas create [--name NAME] [--use]
  mico canvas use <id>
  mico canvas rename <id> <name>
  mico canvas delete <id>
  mico canvas get <id>
  mico board get [--canvas ID]
  mico shape create '<shape JSON>' [--canvas ID]
  mico shape update <id> '<patch JSON>' [--canvas ID]
  mico shape delete <id> [--canvas ID]
  mico batch <file|-> [--canvas ID]

Boards default to the active canvas. Use --canvas to target another canvas.
Batch accepts a JSON array of operations or {"operations": [...]}.
Use - to read the batch from stdin.`

function parseObject(value: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(value)
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('Expected a JSON object')
	}
	return parsed as Record<string, unknown>
}

function takeOption(args: string[], name: string): [string[], string | undefined] {
	const index = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`))
	if (index < 0) return [args, undefined]
	const argument = args[index]
	if (argument.includes('=')) {
		const value = argument.split('=').slice(1).join('=')
		if (value === '') throw new Error(`${name} requires a value`)
		return [args.filter((_, i) => i !== index), value]
	}
	const value = args[index + 1]
	if (value === undefined || value === '') throw new Error(`${name} requires a value`)
	return [args.filter((_, i) => i !== index && i !== index + 1), value]
}

async function readStdin(): Promise<string> {
	let input = ''
	for await (const chunk of process.stdin) input += chunk
	return input
}

async function request(port: number, path: string, init: RequestInit = {}): Promise<unknown> {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, init)
	const result: unknown = await response.json()
	if (!response.ok) throw new Error(JSON.stringify(result))
	return result
}

async function main(args: string[]) {
	if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
		console.log(usage)
		return
	}

	const port = process.env.MICO_PORT ?? String(DAEMON_PORT)
	if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
		throw new Error('MICO_PORT must be a valid port number')
	}

	args = [...args]
	let canvasId: string | undefined
	;[args, canvasId] = takeOption(args, '--canvas')
	if (args.length === 0) throw new Error(usage)

	let result: unknown
	const [resource, action, ...restArgs] = args
	const rest = restArgs

	if (resource === 'board' && action === 'get') {
		if (rest.length > 0) throw new Error(usage)
		result = await request(Number(port), '/api/board')
		console.log(JSON.stringify(result, null, 2))
		return
	}

	if (resource === 'shape') {
		let body: unknown
		if (action === 'create' && rest.length === 1) {
			const shape = parseObject(rest[0])
			body = {
				operations: [{ type: 'create', shape: { ...shape, id: shape.id ?? randomUUID() } }],
				...(canvasId ? { canvasId } : {}),
			}
		} else if (action === 'update' && rest.length === 2) {
			body = {
				operations: [{ type: 'update', id: rest[0], patch: parseObject(rest[1]) }],
				...(canvasId ? { canvasId } : {}),
			}
		} else if (action === 'delete' && rest.length === 1) {
			body = {
				operations: [{ type: 'delete', id: rest[0] }],
				...(canvasId ? { canvasId } : {}),
			}
		} else {
			throw new Error(usage)
		}
		result = await request(Number(port), '/api/operations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		console.log(JSON.stringify(result, null, 2))
		return
	}

	if (resource === 'batch' && action !== undefined) {
		if (rest.length > 0) throw new Error(usage)
		const input: unknown = JSON.parse(
			action === '-' ? await readStdin() : await readFile(action, 'utf8'),
		)
		const body = Array.isArray(input) ? { operations: input } : (input as Record<string, unknown>)
		if (canvasId) body.canvasId = canvasId
		result = await request(Number(port), '/api/operations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		console.log(JSON.stringify(result, null, 2))
		return
	}

	throw new Error(usage)
}

main(process.argv.slice(2)).catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
