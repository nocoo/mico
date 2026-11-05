import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const INPUT_LIMIT = 64 * 1024
const PROMPT_LIMIT = 16 * 1024
const RESPONSE_LIMIT = 40 * 1024 * 1024
const PNG_LIMIT = 10 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 120_000

const SIZES = {
	'1:1': { width: 1024, height: 1024 },
	'3:2': { width: 1536, height: 1024 },
	'2:3': { width: 1024, height: 1536 },
} as const

export type ImageAspect = keyof typeof SIZES

export interface ImageRequest {
	prompt: string
	aspect: ImageAspect
}

class ScriptError extends Error {
	readonly code: 'input' | 'configuration' | 'generation'

	constructor(code: 'input' | 'configuration' | 'generation') {
		super(code)
		this.code = code
	}
}

export function validateImageRequest(value: unknown): ImageRequest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ScriptError('input')
	}
	const keys = Object.keys(value)
	if (keys.length !== 2 || !keys.includes('prompt') || !keys.includes('aspect')) {
		throw new ScriptError('input')
	}
	const candidate = value as Record<string, unknown>
	if (typeof candidate.prompt !== 'string') throw new ScriptError('input')
	if (candidate.prompt.length === 0 || candidate.prompt.length > PROMPT_LIMIT) {
		throw new ScriptError('input')
	}
	if (candidate.prompt.trim().length === 0) throw new ScriptError('input')
	if (typeof candidate.aspect !== 'string' || !Object.hasOwn(SIZES, candidate.aspect)) {
		throw new ScriptError('input')
	}
	return { prompt: candidate.prompt, aspect: candidate.aspect as ImageAspect }
}

async function readBoundedStream(stream: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
	const chunks: Buffer[] = []
	let total = 0
	for await (const chunk of stream) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		total += bytes.length
		if (total > limit) throw new ScriptError('generation')
		chunks.push(bytes)
	}
	return Buffer.concat(chunks, total)
}

async function readBoundedStdin(limit: number): Promise<Buffer> {
	return readBoundedStream(process.stdin, limit)
}

function buildGenerationUrl(endpoint: string): URL {
	if (endpoint.length > 2048) throw new ScriptError('configuration')
	let url: URL
	try {
		url = new URL(endpoint)
	} catch {
		throw new ScriptError('configuration')
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new ScriptError('configuration')
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new ScriptError('configuration')
	}
	url.pathname = `${url.pathname.replace(/\/+$/, '')}/images/generations`
	return url
}

export function validatePng(png: Buffer): void {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10]
	if (png.length < 8 || png.length > PNG_LIMIT) throw new ScriptError('generation')
	if (!signature.every((byte, index) => png[index] === byte)) {
		throw new ScriptError('generation')
	}
}

export function decodeGenerationResponse(body: Buffer): Buffer {
	if (body.length === 0 || body.length > RESPONSE_LIMIT) throw new ScriptError('generation')
	let response: unknown
	try {
		response = JSON.parse(body.toString('utf8'))
	} catch {
		throw new ScriptError('generation')
	}
	if (typeof response !== 'object' || response === null || Array.isArray(response)) {
		throw new ScriptError('generation')
	}
	const data = (response as Record<string, unknown>).data
	if (!Array.isArray(data) || data.length !== 1) throw new ScriptError('generation')
	const item = data[0]
	if (typeof item !== 'object' || item === null || Array.isArray(item)) {
		throw new ScriptError('generation')
	}
	const encoded = (item as Record<string, unknown>).b64_json
	if (typeof encoded !== 'string' || encoded.length === 0) {
		throw new ScriptError('generation')
	}
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}={0,2}|[A-Za-z0-9+/]{3}={0,1})?$/.test(encoded)) {
		throw new ScriptError('generation')
	}
	const png = Buffer.from(encoded, 'base64')
	if (png.length === 0 || png.length > PNG_LIMIT) throw new ScriptError('generation')
	validatePng(png)
	return png
}

async function readResponseBody(response: Response, limit: number): Promise<Buffer> {
	const contentLength = response.headers.get('content-length')
	if (contentLength) {
		const length = Number(contentLength)
		if (!Number.isSafeInteger(length) || length < 0 || length > limit) {
			throw new ScriptError('generation')
		}
	}
	if (!response.body) throw new ScriptError('generation')
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (!value) throw new ScriptError('generation')
			total += value.byteLength
			if (total > limit) {
				await reader.cancel().catch(() => undefined)
				throw new ScriptError('generation')
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}
	return Buffer.concat(
		chunks.map((chunk) => Buffer.from(chunk)),
		total,
	)
}

export async function generateImage(
	requestValue: unknown,
	endpoint: string,
	apiKey: string,
	timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Buffer> {
	const request = validateImageRequest(requestValue)
	if (apiKey.trim().length === 0) throw new ScriptError('configuration')
	const url = buildGenerationUrl(endpoint)
	const size = SIZES[request.aspect]

	let response: Response
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'api-key': apiKey,
				'content-type': 'application/json',
				accept: 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-image-2.5-flare',
				prompt: request.prompt,
				n: 1,
				quality: 'high',
				size: `${size.width}x${size.height}`,
			}),
			redirect: 'manual',
			signal: AbortSignal.timeout(timeoutMs),
		})
	} catch {
		throw new ScriptError('generation')
	}

	if (response.status >= 300 && response.status < 400) {
		throw new ScriptError('generation')
	}
	if (response.headers.has('location')) throw new ScriptError('generation')
	if (!response.ok) throw new ScriptError('generation')

	const body = await readResponseBody(response, RESPONSE_LIMIT)
	return decodeGenerationResponse(body)
}

async function readRequest(): Promise<unknown> {
	let input: Buffer
	try {
		input = await readBoundedStdin(INPUT_LIMIT)
		return JSON.parse(input.toString('utf8'))
	} catch {
		throw new ScriptError('input')
	}
}

async function writePng(png: Buffer): Promise<void> {
	await new Promise<void>((resolveWrite, rejectWrite) => {
		process.stdout.write(png, (error) => {
			if (error) rejectWrite(error)
			else resolveWrite()
		})
	})
}

async function main(): Promise<void> {
	let png: Buffer
	try {
		const endpoint = process.env.AZURE_OPENAI_ENDPOINT
		const apiKey = process.env.AZURE_OPENAI_API_KEY
		if (!endpoint || apiKey === undefined) throw new ScriptError('configuration')
		const request = await readRequest()
		png = await generateImage(request, endpoint, apiKey)
		await writePng(png)
	} catch (error) {
		if (error instanceof ScriptError) {
			if (error.code === 'input') process.stderr.write('Invalid input\n')
			else if (error.code === 'configuration') process.stderr.write('Configuration error\n')
			else process.stderr.write('Image generation failed\n')
		} else {
			process.stderr.write('Image generation failed\n')
		}
		process.exitCode = 1
	}
}

const isDirectRun =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
	void main()
}
