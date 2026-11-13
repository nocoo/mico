import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadImageConfig } from '../src/server/aiConfig.ts'
import {
	decodeGenerationResponse,
	generateImage,
	validateImageRequest,
	validatePng,
} from './generate-image.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

function fakePng(): Buffer {
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		Buffer.from('C2PA-metadata-preserved'),
	])
}

interface ScriptResult {
	code: number | null
	stdout: Buffer
	stderr: string
}

async function runScript(
	input: unknown,
	endpoint: string,
	apiKey = 'fake-local-test-key',
	model?: string,
): Promise<ScriptResult> {
	const child = spawn(process.execPath, ['scripts/generate-image.ts'], {
		cwd: root,
		env: {
			...process.env,
			AZURE_OPENAI_ENDPOINT: endpoint,
			AZURE_OPENAI_API_KEY: apiKey,
			AZURE_OPENAI_IMAGE_MODEL: model,
		},
		stdio: ['pipe', 'pipe', 'pipe'],
	})
	const stdout: Buffer[] = []
	let stderr = ''
	child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
	child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
		stderr += chunk
	})
	child.stdin.end(JSON.stringify(input))
	try {
		const [code] = await once(child, 'close', { signal: AbortSignal.timeout(20_000) })
		return { code: code as number | null, stdout: Buffer.concat(stdout), stderr }
	} finally {
		if (child.exitCode === null) child.kill('SIGKILL')
	}
}

async function listen(server: Server): Promise<string> {
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const address = server.address() as AddressInfo
	return `http://127.0.0.1:${address.port}/openai/v1`
}

async function closeServer(server: Server): Promise<void> {
	server.close()
	await once(server, 'close')
}

test('image request validation accepts the three native aspect contracts', () => {
	assert.deepEqual(validateImageRequest({ prompt: 'A small blue boat', aspect: '1:1' }), {
		prompt: 'A small blue boat',
		aspect: '1:1',
	})
	assert.deepEqual(validateImageRequest({ prompt: 'A small blue boat', aspect: '3:2' }), {
		prompt: 'A small blue boat',
		aspect: '3:2',
	})
	assert.deepEqual(validateImageRequest({ prompt: 'A small blue boat', aspect: '2:3' }), {
		prompt: 'A small blue boat',
		aspect: '2:3',
	})
	assert.throws(() => validateImageRequest({ prompt: '', aspect: '1:1' }))
	assert.throws(() => validateImageRequest({ prompt: '   ', aspect: '1:1' }))
	assert.throws(() => validateImageRequest({ prompt: 'boat', aspect: '16:9' }))
	assert.throws(() => validateImageRequest({ prompt: 'boat', aspect: 'toString' }))
	assert.throws(() => validateImageRequest({ prompt: 'boat', aspect: '1:1', extra: true }))
	assert.throws(() => validateImageRequest(null))
})

test('PNG validation matches the app signature and 10 MB size bound', () => {
	const png = fakePng()
	assert.doesNotThrow(() => validatePng(png))
	assert.throws(() => validatePng(Buffer.from('not a png')))
	assert.throws(() => validatePng(Buffer.alloc(10 * 1024 * 1024 + 1)))
})

test('generation response validation requires one b64 PNG response', () => {
	const png = fakePng()
	assert.deepEqual(
		decodeGenerationResponse(
			Buffer.from(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })),
		),
		png,
	)
	assert.throws(() => decodeGenerationResponse(Buffer.from('{}')))
	assert.throws(() =>
		decodeGenerationResponse(
			Buffer.from(JSON.stringify({ data: [{ b64_json: '%%%not-base64%%%' }] })),
		),
	)
	assert.throws(() =>
		decodeGenerationResponse(
			Buffer.from(JSON.stringify({ data: [{ b64_json: Buffer.from('bad').toString('base64') }] })),
		),
	)
})

test('script posts the flare contract and prints only raw PNG bytes', async () => {
	const requests: Record<string, unknown>[] = []
	const server = createServer((request, response) => {
		const chunks: Buffer[] = []
		request.on('data', (chunk: Buffer) => chunks.push(chunk))
		request.on('end', () => {
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
			requests.push({ ...body, apiKey: request.headers['api-key'] })
			const png = fakePng()
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
		})
	})
	const endpoint = await listen(server)
	try {
		for (const aspect of ['1:1', '3:2', '2:3'] as const) {
			const result = await runScript({ prompt: `fake ${aspect}`, aspect }, endpoint)
			assert.equal(result.code, 0)
			assert.equal(result.stderr, '')
			assert.deepEqual(result.stdout, fakePng())
			assert.doesNotThrow(() => validatePng(result.stdout))
		}
		assert.equal(requests.length, 3)
		for (const request of requests) {
			assert.equal(request.apiKey, 'fake-local-test-key')
			assert.equal(request.model, 'gpt-image-2.5-flare')
			assert.equal(request.n, 1)
			assert.equal(request.quality, 'high')
		}
		assert.deepEqual(
			requests.map((request) => request.size),
			['1024x1024', '1536x1024', '1024x1536'],
		)
	} finally {
		await closeServer(server)
	}
})

test('script stops if its owning daemon disconnects', async () => {
	const server = createServer((request) => request.resume())
	const requestSeen = once(server, 'request', { signal: AbortSignal.timeout(5000) })
	const endpoint = await listen(server)
	const child = spawn(process.execPath, ['scripts/generate-image.ts'], {
		cwd: root,
		env: { AZURE_OPENAI_ENDPOINT: endpoint, AZURE_OPENAI_API_KEY: 'fake-key' },
		stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
	})
	assert.ok(child.stdin)
	child.stdin.end(JSON.stringify({ prompt: 'A quiet horizon', aspect: '1:1' }))
	try {
		await requestSeen.catch(() => {
			throw new Error('The local provider was not contacted')
		})
		const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
		child.disconnect()
		const [code] = await exited.catch(() => {
			throw new Error('The script did not exit on disconnect')
		})
		assert.equal(code, 1)
	} finally {
		if (child.exitCode === null) child.kill('SIGKILL')
		server.closeAllConnections()
		await closeServer(server)
	}
})

test('script rejects redirects and emits no provider bytes', async () => {
	const server = createServer((_request, response) => {
		response.writeHead(302, { location: '/redirected', 'content-type': 'text/html' })
		response.end('<html>redirect</html>')
	})
	const endpoint = await listen(server)
	try {
		const result = await runScript({ prompt: 'fake redirect', aspect: '1:1' }, endpoint)
		assert.equal(result.code, 1)
		assert.equal(result.stdout.length, 0)
		assert.equal(result.stderr, 'Image generation failed\n')
	} finally {
		await closeServer(server)
	}
})

test('script rejects invalid stdin without contacting a provider', async () => {
	for (const input of [
		{ prompt: '', aspect: '1:1' },
		{ prompt: 'fake', aspect: '16:9' },
		{ prompt: 'fake', aspect: '1:1', extra: true },
	]) {
		const result = await runScript(input, 'http://127.0.0.1:1/openai/v1')
		assert.equal(result.code, 1)
		assert.equal(result.stdout.length, 0)
		assert.equal(result.stderr, 'Invalid input\n')
	}
})

test('generateImage bounds provider timeouts with fake credentials', async () => {
	const server = createServer((_request, _response) => {})
	const endpoint = await listen(server)
	try {
		await assert.rejects(
			generateImage(
				{ prompt: 'fake timeout', aspect: '1:1' },
				loadImageConfig({
					AZURE_OPENAI_ENDPOINT: endpoint,
					AZURE_OPENAI_API_KEY: 'fake-timeout-key',
				}),
				20,
			),
			(error: unknown) => error instanceof Error,
		)
	} finally {
		await closeServer(server)
	}
})
