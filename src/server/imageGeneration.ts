import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { type ImageProviderConfig, loadImageConfig } from './aiConfig.ts'
import type { BoardStore, GeneratedImagePlacement } from './store.ts'
import { MAX_CANVAS_IMAGES, OperationError } from './store.ts'

export type ImageAspect = '1:1' | '3:2' | '2:3'

export interface ImageGenerationRequest {
	prompt: string
	aspect: ImageAspect
	canvasId: string
	x: number
	y: number
	width: number
	frameId?: string
	shapeId?: string
}

export type ImageGenerator = (request: {
	prompt: string
	aspect: ImageAspect
}) => Promise<Uint8Array> | Uint8Array

export type ImageGenerationStatus =
	| {
			ok: true
			jobId: string
			status: 'pending'
			canvasId: string
			shapeId: string
	  }
	| {
			ok: true
			jobId: string
			status: 'completed'
			canvasId: string
			shapeId: string
			imageId: string
			x: number
			y: number
			w: number
			h: number
			backgroundApplied: boolean
	  }
	| {
			ok: true
			jobId: string
			status: 'failed'
			canvasId: string
			shapeId: string
			code: string
			message: string
	  }

interface Job {
	jobId: string
	shapeId: string
	canvasId: string
	status: 'pending' | 'completed' | 'failed'
	prompt: string
	aspect: ImageAspect
	x: number
	y: number
	width: number
	height: number
	frameId?: string
	imageId?: string
	backgroundApplied?: boolean
	code?: string
	message?: string
}

interface ImageGenerationOptions {
	generator?: ImageGenerator
	config?: ImageProviderConfig
	env?: NodeJS.ProcessEnv
	scriptPath?: string
	timeoutMs?: number
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_PROMPT_LENGTH = 16 * 1024
const MAX_WIDTH = 4096

export class ImageGenerationService {
	private readonly jobs = new Map<string, Job>()
	private readonly store: BoardStore
	private readonly broadcast: (event: unknown) => void
	private readonly generator?: ImageGenerator
	private readonly env: NodeJS.ProcessEnv
	private readonly scriptPath: string
	private readonly timeoutMs: number
	private busyJobId: string | undefined
	private latestJobId: string | undefined
	private child: ChildProcess | undefined
	private closed = false

	constructor(
		store: BoardStore,
		broadcast: (event: unknown) => void,
		options: ImageGenerationOptions = {},
	) {
		this.store = store
		this.broadcast = broadcast
		this.generator = options.generator
		const config = options.config ?? loadImageConfig()
		this.env = {
			...(options.env ?? process.env),
			AZURE_OPENAI_ENDPOINT: config.endpoint,
			AZURE_OPENAI_API_KEY: config.apiKey,
			AZURE_OPENAI_IMAGE_MODEL: config.model,
		}
		this.scriptPath =
			options.scriptPath ??
			fileURLToPath(new URL('../../scripts/generate-image.ts', import.meta.url))
		this.timeoutMs = options.timeoutMs ?? 185_000
	}

	getBusyJobId(): string | undefined {
		return this.busyJobId
	}

	async start(request: ImageGenerationRequest): Promise<{
		ok: true
		status: 'pending'
		jobId: string
		shapeId: string
		canvasId: string
	}> {
		if (this.busyJobId) {
			throw new OperationError(
				409,
				'IMAGE_GENERATION_BUSY',
				`Image generation is already running as job ${this.busyJobId}. Wait for image_generation_status to report completed or failed before starting another.`,
			)
		}
		if (this.closed) {
			throw new OperationError(503, 'IMAGE_GENERATION_CLOSED', 'Image generation service is closed')
		}
		if (typeof request.prompt !== 'string' || request.prompt.trim().length === 0) {
			throw new OperationError(400, 'INVALID_REQUEST', 'prompt must be a non-empty string')
		}
		if (request.prompt.length > MAX_PROMPT_LENGTH) {
			throw new OperationError(400, 'INVALID_REQUEST', 'prompt exceeds 16 KB')
		}
		if (!['1:1', '3:2', '2:3'].includes(request.aspect)) {
			throw new OperationError(400, 'INVALID_REQUEST', 'aspect must be 1:1, 3:2 or 2:3')
		}
		if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) {
			throw new OperationError(400, 'INVALID_REQUEST', 'x and y must be finite numbers')
		}
		if (!Number.isFinite(request.width) || request.width < 1 || request.width > MAX_WIDTH) {
			throw new OperationError(400, 'INVALID_REQUEST', 'width must be between 1 and 4096 pixels')
		}

		const board = await this.store.getBoard(request.canvasId)
		const shapeId = request.shapeId ?? `image-${randomUUID().slice(0, 8)}`
		if (
			typeof shapeId !== 'string' ||
			shapeId.length === 0 ||
			shapeId.length > 64 ||
			!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(shapeId)
		) {
			throw new OperationError(
				400,
				'INVALID_REQUEST',
				'shapeId must use letters, digits, dash or underscore',
			)
		}
		if (board.shapes.some((shape) => shape.id === shapeId)) {
			throw new OperationError(400, 'DUPLICATE_ID', `shape id already exists: ${shapeId}`)
		}
		if ((await this.store.countImageShapes(request.canvasId)) >= MAX_CANVAS_IMAGES) {
			throw new OperationError(
				409,
				'IMAGE_CAP_REACHED',
				`This canvas already has ${MAX_CANVAS_IMAGES} image shapes. Reuse or remove an existing image shape instead of generating another.`,
			)
		}
		const height =
			request.aspect === '1:1'
				? request.width
				: request.aspect === '3:2'
					? (request.width * 2) / 3
					: (request.width * 3) / 2
		if (
			!(await this.store.isPlacementClear(
				request.canvasId,
				request.x,
				request.y,
				request.width,
				height,
			))
		) {
			throw new OperationError(
				409,
				'IMAGE_POSITION_OCCUPIED',
				'The proposed image position overlaps existing canvas objects. Choose a clear area and retry without starting generation.',
			)
		}
		if (request.frameId) {
			const frame = board.shapes.find((shape) => shape.id === request.frameId)
			if (!frame) {
				throw new OperationError(404, 'NOT_FOUND', `frame not found: ${request.frameId}`)
			}
			if (frame.type !== 'frame') {
				throw new OperationError(
					400,
					'INVALID_REQUEST',
					`frameId must reference a frame: ${request.frameId}`,
				)
			}
			if (frame.backgroundImageId) {
				throw new OperationError(
					409,
					'FRAME_BACKGROUND_EXISTS',
					`Frame ${request.frameId} already has a background image. Choose a frame without an existing background or unlink its background first.`,
				)
			}
		}

		const jobId = `image-job-${randomUUID().slice(0, 8)}`
		const job: Job = {
			jobId,
			shapeId,
			canvasId: request.canvasId,
			status: 'pending',
			prompt: request.prompt,
			aspect: request.aspect,
			x: request.x,
			y: request.y,
			width: request.width,
			height,
			frameId: request.frameId,
		}
		this.jobs.set(jobId, job)
		this.busyJobId = jobId
		this.latestJobId = jobId
		void this.run(job)
		return { ok: true, status: 'pending', jobId, shapeId, canvasId: request.canvasId }
	}

	status(jobId?: string): ImageGenerationStatus | { ok: false; error: string; message: string } {
		const job = jobId ? this.jobs.get(jobId) : undefined
		if (jobId && !job) {
			return {
				ok: false,
				error: 'JOB_NOT_FOUND',
				message: `Image generation job not found: ${jobId}`,
			}
		}
		const selected =
			job ??
			(this.busyJobId
				? this.jobs.get(this.busyJobId)
				: this.latestJobId
					? this.jobs.get(this.latestJobId)
					: undefined)
		if (!selected) {
			return {
				ok: false,
				error: 'NO_IMAGE_GENERATION_JOB',
				message: 'No image generation job is pending or known in this daemon.',
			}
		}
		if (selected.status === 'pending') {
			return {
				ok: true,
				jobId: selected.jobId,
				status: 'pending',
				canvasId: selected.canvasId,
				shapeId: selected.shapeId,
			}
		}
		if (selected.status === 'completed') {
			return {
				ok: true,
				jobId: selected.jobId,
				status: 'completed',
				canvasId: selected.canvasId,
				shapeId: selected.shapeId,
				imageId: selected.imageId ?? '',
				x: selected.x,
				y: selected.y,
				w: selected.width,
				h: selected.height,
				backgroundApplied: selected.backgroundApplied ?? false,
			}
		}
		return {
			ok: true,
			jobId: selected.jobId,
			status: 'failed',
			canvasId: selected.canvasId,
			shapeId: selected.shapeId,
			code: selected.code ?? 'IMAGE_GENERATION_FAILED',
			message: selected.message ?? 'Image generation failed',
		}
	}

	close(): void {
		this.closed = true
		if (this.child && !this.child.killed) this.child.kill('SIGKILL')
	}

	private fail(job: Job, code: string, message: string): void {
		job.status = 'failed'
		job.code = code
		job.message = message
		if (this.busyJobId === job.jobId) this.busyJobId = undefined
	}

	private async generate(request: { prompt: string; aspect: ImageAspect }): Promise<Uint8Array> {
		if (this.generator) return this.generator(request)
		return this.generateWithScript(request)
	}

	private generateWithScript(request: {
		prompt: string
		aspect: ImageAspect
	}): Promise<Uint8Array> {
		return new Promise((resolvePromise, reject) => {
			const child = spawn(process.execPath, [this.scriptPath], {
				env: this.env,
				stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
			})
			if (!child.stdin || !child.stdout) {
				child.kill('SIGKILL')
				reject(new Error('Could not start image generation'))
				return
			}
			const stdin = child.stdin
			const output = child.stdout
			this.child = child
			let stdout = 0
			const chunks: Buffer[] = []
			let settled = false
			const finish = (error?: Error, bytes?: Uint8Array) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				if (this.child === child) this.child = undefined
				if (error) reject(error)
				else resolvePromise(bytes ?? new Uint8Array())
			}
			const timer = setTimeout(() => {
				if (!child.killed) child.kill('SIGKILL')
				finish(new Error('Image generation timed out'))
			}, this.timeoutMs)
			stdin.on('error', (error) => {
				if (!child.killed) child.kill('SIGKILL')
				finish(
					error instanceof Error ? error : new Error('Could not write image generation request'),
				)
			})
			output.on('data', (chunk: Buffer) => {
				stdout += chunk.byteLength
				if (stdout > MAX_IMAGE_BYTES) {
					if (!child.killed) child.kill('SIGKILL')
					finish(new Error('Generated image exceeds 10 MB'))
					return
				}
				chunks.push(chunk)
			})
			child.on('error', () => finish(new Error('Could not start image generation')))
			child.on('close', (code) => {
				if (code !== 0) finish(new Error('Image generation failed'))
				else finish(undefined, Buffer.concat(chunks, stdout))
			})
			try {
				stdin.end(JSON.stringify({ prompt: request.prompt, aspect: request.aspect }))
			} catch {
				finish(new Error('Could not start image generation'))
			}
		})
	}

	private async run(job: Job): Promise<void> {
		try {
			const bytes = await this.generate({ prompt: job.prompt, aspect: job.aspect })
			if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
				throw new OperationError(
					502,
					'IMAGE_GENERATION_FAILED',
					'Image generator returned no PNG bytes',
				)
			}
			if (bytes.byteLength > MAX_IMAGE_BYTES) {
				throw new OperationError(413, 'IMAGE_TOO_LARGE', 'Generated image exceeds 10 MB')
			}
			const png = bytes.slice()
			const placement: GeneratedImagePlacement = {
				canvasId: job.canvasId,
				shapeId: job.shapeId,
				frameId: job.frameId,
				x: job.x,
				y: job.y,
				w: job.width,
				h: job.height,
				bytes: png,
			}
			const result = await this.store.placeGeneratedImage(placement)
			job.status = 'completed'
			job.imageId = result.imageId
			job.x = result.position.x
			job.y = result.position.y
			job.width = result.position.w
			job.height = result.position.h
			job.backgroundApplied = result.backgroundApplied
			this.broadcast({
				type: 'board',
				canvasId: result.canvasId,
				canvas: result.canvas,
				board: result.board,
			})
		} catch (error) {
			if (error instanceof OperationError) this.fail(job, error.code, error.message)
			else this.fail(job, 'IMAGE_GENERATION_FAILED', 'Image generation failed')
		} finally {
			if (this.busyJobId === job.jobId) this.busyJobId = undefined
		}
	}
}
