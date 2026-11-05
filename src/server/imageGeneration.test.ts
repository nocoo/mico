import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCanvasTools } from './aiTools.ts'
import { ImageGenerationService } from './imageGeneration.ts'
import { createMossSession, executeMossTool } from './mossApi.ts'
import { BoardStore, OperationError } from './store.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function waitForStatus(
	service: ImageGenerationService,
	jobId: string,
): Promise<Record<string, unknown>> {
	for (let index = 0; index < 1000; index++) {
		const status = service.status(jobId) as Record<string, unknown>
		if (status.status !== 'pending') return status
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
	throw new Error('image generation did not finish')
}

async function withStore(
	run: (store: BoardStore, directory: string) => Promise<void> | void,
): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-image-generation-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		await run(store, directory)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

function runTool(tool: unknown, input: unknown): Promise<unknown> {
	return (tool as { execute: (value: unknown, options: unknown) => Promise<unknown> }).execute(
		input,
		{ toolCallId: 'test', messages: [] },
	)
}

test('the real script inserts a generated image using a local mock provider', async () => {
	let received: unknown
	const provider = createServer((request, response) => {
		const chunks: Buffer[] = []
		request.on('data', (chunk: Buffer) => chunks.push(chunk))
		request.on('end', () => {
			assert.equal(request.url, '/openai/v1/images/generations')
			assert.equal(request.headers['api-key'], 'fake-key')
			received = JSON.parse(Buffer.concat(chunks).toString('utf8'))
			response.writeHead(200, { 'Content-Type': 'application/json' })
			response.end(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }))
		})
	})
	provider.listen(0, '127.0.0.1')
	await once(provider, 'listening')
	const address = provider.address()
	assert.ok(address && typeof address !== 'string')
	try {
		await withStore(async (store) => {
			const events: unknown[] = []
			const service = new ImageGenerationService(store, (event) => events.push(event), {
				env: {
					AZURE_OPENAI_ENDPOINT: `http://127.0.0.1:${address.port}/openai/v1`,
					AZURE_OPENAI_API_KEY: 'fake-key',
				},
			})
			try {
				const job = service.start({
					prompt: 'A calm blue horizon',
					aspect: '3:2',
					canvasId: store.getActiveCanvasId(),
					x: 100,
					y: 150,
					width: 300,
				})
				const result = await waitForStatus(service, job.jobId)
				assert.equal(result.status, 'completed')
				assert.deepEqual(received, {
					model: 'gpt-image-2.5-flare',
					prompt: 'A calm blue horizon',
					n: 1,
					quality: 'high',
					size: '1536x1024',
				})
				assert.deepEqual(store.getImage(result.imageId)?.bytes, Buffer.from(PNG))
				assert.equal(store.getBoard().shapes.filter((shape) => shape.type === 'image').length, 1)
				assert.equal(events.length, 1)
			} finally {
				service.close()
			}
		})
	} finally {
		provider.close()
		await once(provider, 'close')
	}
})

test('manual image caps reject a sixth shape and preserve existing data', async () => {
	await withStore((store) => {
		const assetIds = Array.from({ length: 5 }, () => store.saveImage(PNG, 'image/png'))
		const operations = assetIds.map((imageId, index) => ({
			type: 'create' as const,
			shape: {
				id: `image-${index}`,
				type: 'image' as const,
				x: index * 200,
				y: 0,
				w: 100,
				h: 100,
				color: '#2b3038',
				imageId,
			},
		}))
		store.apply({ operations })
		assert.equal(store.countImageShapes(store.getActiveCanvasId()), 5)

		const extraAssetId = store.saveImage(PNG, 'image/png')
		assert.throws(
			() =>
				store.apply({
					operations: [
						{
							type: 'create',
							shape: {
								id: 'image-6',
								type: 'image',
								x: 1200,
								y: 0,
								w: 100,
								h: 100,
								color: '#2b3038',
								imageId: extraAssetId,
							},
						},
					],
				}),
			(error: unknown) => error instanceof OperationError && error.code === 'IMAGE_CAP_REACHED',
		)
		assert.equal(store.countImageShapes(store.getActiveCanvasId()), 5)
	})
})

test('busy is daemon-wide and occupied placement is rejected before generation', async () => {
	await withStore(async (store) => {
		const other = store.createCanvas('Other')
		let calls = 0
		let resolveGenerator: ((bytes: Uint8Array) => void) | undefined
		const service = new ImageGenerationService(store, () => {}, {
			generator: () => {
				calls += 1
				return new Promise<Uint8Array>((resolve) => {
					resolveGenerator = resolve
				})
			},
		})
		const first = service.start({
			prompt: 'A clear illustration',
			aspect: '1:1',
			canvasId: store.getActiveCanvasId(),
			x: 500,
			y: 500,
			width: 300,
		})
		assert.equal(first.status, 'pending')
		assert.throws(
			() =>
				service.start({
					prompt: 'A second illustration',
					aspect: '3:2',
					canvasId: other.canvas.id,
					x: 100,
					y: 100,
					width: 300,
				}),
			(error: unknown) => error instanceof OperationError && error.code === 'IMAGE_GENERATION_BUSY',
		)
		assert.equal(calls, 1)

		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'occupied',
						type: 'rectangle',
						x: 100,
						y: 100,
						w: 300,
						h: 300,
						color: '#123456',
					},
				},
			],
		})
		assert.throws(
			() =>
				service.start({
					prompt: 'No provider call',
					aspect: '1:1',
					canvasId: store.getActiveCanvasId(),
					x: 100,
					y: 100,
					width: 300,
				}),
			(error: unknown) => error instanceof OperationError && error.code === 'IMAGE_GENERATION_BUSY',
		)

		resolveGenerator?.(PNG)
		const completed = await waitForStatus(service, first.jobId)
		assert.equal(completed.status, 'completed')
		assert.equal(calls, 1)
		assert.throws(
			() =>
				service.start({
					prompt: 'No provider call',
					aspect: '1:1',
					canvasId: store.getActiveCanvasId(),
					x: 100,
					y: 100,
					width: 300,
				}),
			(error: unknown) =>
				error instanceof OperationError && error.code === 'IMAGE_POSITION_OCCUPIED',
		)
		assert.equal(calls, 1)
	})
})

test('pinned connector anchor bounds block image placement', async () => {
	await withStore((store) => {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'left',
						type: 'rectangle',
						x: 100,
						y: 100,
						w: 100,
						h: 100,
						color: '#123456',
					},
				},
				{
					type: 'create',
					shape: {
						id: 'right',
						type: 'rectangle',
						x: 500,
						y: 100,
						w: 100,
						h: 100,
						color: '#123456',
					},
				},
				{
					type: 'create',
					shape: {
						id: 'pinned-link',
						type: 'connector',
						from: 'left',
						to: 'right',
						color: '#654321',
						fromAnchor: 0,
						toAnchor: 0,
					},
				},
			],
		})
		let calls = 0
		const service = new ImageGenerationService(store, () => {}, {
			generator: async () => {
				calls += 1
				return PNG
			},
		})
		assert.throws(
			() =>
				service.start({
					prompt: 'Do not cover the pinned connector',
					aspect: '1:1',
					canvasId: store.getActiveCanvasId(),
					x: 300,
					y: 100,
					width: 100,
				}),
			(error: unknown) =>
				error instanceof OperationError && error.code === 'IMAGE_POSITION_OCCUPIED',
		)
		assert.equal(calls, 0)
	})
})

test('generation failure releases the busy lock', async () => {
	await withStore(async (store) => {
		let fail = true
		const calls: string[] = []
		const service = new ImageGenerationService(store, () => {}, {
			generator: async ({ prompt }) => {
				calls.push(prompt)
				if (fail) throw new Error('credential failure')
				return PNG
			},
		})
		const canvasId = store.getActiveCanvasId()
		const failed = service.start({
			prompt: 'First attempt',
			aspect: '1:1',
			canvasId,
			x: 100,
			y: 100,
			width: 200,
		})
		const failedStatus = await waitForStatus(service, failed.jobId)
		assert.equal(failedStatus.status, 'failed')
		assert.equal(service.getBusyJobId(), undefined)

		fail = false
		const retried = service.start({
			prompt: 'Second attempt',
			aspect: '1:1',
			canvasId,
			x: 400,
			y: 400,
			width: 200,
		})
		const retriedStatus = await waitForStatus(service, retried.jobId)
		assert.equal(retriedStatus.status, 'completed')
		assert.deepEqual(calls, ['First attempt', 'Second attempt'])
	})
})

test('occupied placement at completion moves just beyond rightmost bounds', async () => {
	await withStore(async (store) => {
		let resolveGenerator: ((bytes: Uint8Array) => void) | undefined
		const service = new ImageGenerationService(store, () => {}, {
			generator: () =>
				new Promise<Uint8Array>((resolve) => {
					resolveGenerator = resolve
				}),
		})
		const canvasId = store.getActiveCanvasId()
		const started = service.start({
			prompt: 'A generated result',
			aspect: '1:1',
			canvasId,
			x: 500,
			y: 500,
			width: 200,
		})
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'late-box',
						type: 'rectangle',
						x: 500,
						y: 500,
						w: 200,
						h: 200,
						color: '#123456',
					},
				},
			],
		})
		resolveGenerator?.(PNG)
		const completed = await waitForStatus(service, started.jobId)
		assert.equal(completed.status, 'completed')
		const board = store.getBoard(canvasId)
		const image = board.shapes.find((shape) => shape.id === started.shapeId)
		assert.ok(image && image.type === 'image')
		assert.equal(image.x, 764)
		assert.equal(image.y, 500)
		assert.ok(
			!(image.x < 700 && image.x + image.w > 500 && image.y < 700 && image.y + image.h > 500),
		)
	})
})

test('existing frame background is rejected before provider call', async () => {
	await withStore((store) => {
		const assetId = store.saveImage(PNG, 'image/png')
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'background-source',
						type: 'image',
						x: 100,
						y: 100,
						w: 200,
						h: 200,
						color: '#2b3038',
						imageId: assetId,
					},
				},
				{
					type: 'create',
					shape: {
						id: 'occupied-frame',
						type: 'frame',
						x: 100,
						y: 100,
						w: 300,
						h: 300,
						color: '#123456',
						title: 'Frame',
						backgroundImageId: 'background-source',
						backgroundFit: 'cover',
					},
				},
			],
		})
		let calls = 0
		const service = new ImageGenerationService(store, () => {}, {
			generator: async () => {
				calls += 1
				return PNG
			},
		})
		assert.throws(
			() =>
				service.start({
					prompt: 'Should not be billed',
					aspect: '1:1',
					canvasId: store.getActiveCanvasId(),
					x: 500,
					y: 500,
					width: 200,
					frameId: 'occupied-frame',
				}),
			(error: unknown) =>
				error instanceof OperationError && error.code === 'FRAME_BACKGROUND_EXISTS',
		)
		assert.equal(calls, 0)
	})
})

test('frame and canvas state changes are reconciled without overwriting', async () => {
	await withStore(async (store) => {
		const canvas = store.createCanvas('Original generation canvas')
		const canvasId = canvas.canvas.id
		store.activateCanvas(canvasId)
		store.apply({
			canvasId,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'frame',
						type: 'frame',
						x: 100,
						y: 100,
						w: 300,
						h: 200,
						color: '#123456',
						title: 'Frame',
					},
				},
			],
		})

		let resolveMoved: ((bytes: Uint8Array) => void) | undefined
		const movedService = new ImageGenerationService(store, () => {}, {
			generator: () =>
				new Promise<Uint8Array>((resolve) => {
					resolveMoved = resolve
				}),
		})
		const moved = movedService.start({
			prompt: 'Move the frame',
			aspect: '3:2',
			canvasId,
			x: 500,
			y: 500,
			width: 300,
			frameId: 'frame',
		})
		store.apply({
			canvasId,
			expectedRevision: store.getBoard(canvasId).revision,
			operations: [{ type: 'update', id: 'frame', patch: { x: 900, y: 300 } }],
		})
		resolveMoved?.(PNG)
		const movedStatus = await waitForStatus(movedService, moved.jobId)
		assert.equal(movedStatus.status, 'completed', JSON.stringify(movedStatus))
		assert.equal((movedStatus as { backgroundApplied: boolean }).backgroundApplied, true)
		const movedBoard = store.getBoard(canvasId)
		const movedFrame = movedBoard.shapes.find((shape) => shape.id === 'frame')
		assert.ok(movedFrame?.type === 'frame')
		assert.equal(movedFrame.backgroundImageId, moved.shapeId)
		store.apply({
			canvasId,
			expectedRevision: store.getBoard(canvasId).revision,
			operations: [{ type: 'update', id: 'frame', patch: { backgroundImageId: null } }],
		})

		const existingAsset = store.saveImage(PNG, 'image/png')
		store.apply({
			canvasId,
			expectedRevision: store.getBoard(canvasId).revision,
			operations: [
				{
					type: 'create',
					shape: {
						id: 'existing-photo',
						type: 'image',
						x: 1200,
						y: 500,
						w: 100,
						h: 100,
						color: '#2b3038',
						imageId: existingAsset,
					},
				},
			],
		})

		let resolveChanged: ((bytes: Uint8Array) => void) | undefined
		const changedService = new ImageGenerationService(store, () => {}, {
			generator: () =>
				new Promise<Uint8Array>((resolve) => {
					resolveChanged = resolve
				}),
		})
		const changed = changedService.start({
			prompt: 'Do not overwrite the frame background',
			aspect: '1:1',
			canvasId,
			x: 500,
			y: 700,
			width: 200,
			frameId: 'frame',
		})
		store.apply({
			canvasId,
			expectedRevision: store.getBoard(canvasId).revision,
			operations: [{ type: 'update', id: 'frame', patch: { backgroundImageId: 'existing-photo' } }],
		})
		resolveChanged?.(PNG)
		const changedStatus = await waitForStatus(changedService, changed.jobId)
		assert.equal(changedStatus.status, 'completed', JSON.stringify(changedStatus))
		assert.equal((changedStatus as { backgroundApplied: boolean }).backgroundApplied, false)
		const changedBoard = store.getBoard(canvasId)
		const changedFrame = changedBoard.shapes.find((shape) => shape.id === 'frame')
		assert.ok(changedFrame?.type === 'frame')
		assert.equal(changedFrame.backgroundImageId, 'existing-photo')

		store.apply({
			canvasId,
			expectedRevision: store.getBoard(canvasId).revision,
			operations: [{ type: 'update', id: 'frame', patch: { backgroundImageId: null } }],
		})

		let resolveDeletedFrame: ((bytes: Uint8Array) => void) | undefined
		const deletedFrameService = new ImageGenerationService(store, () => {}, {
			generator: () =>
				new Promise<Uint8Array>((resolve) => {
					resolveDeletedFrame = resolve
				}),
		})
		const deletedFrame = deletedFrameService.start({
			prompt: 'The frame may disappear',
			aspect: '1:1',
			canvasId,
			x: 1600,
			y: 900,
			width: 200,
			frameId: 'frame',
		})
		store.apply({
			canvasId,
			expectedRevision: store.getBoard(canvasId).revision,
			operations: [{ type: 'delete', id: 'frame' }],
		})
		resolveDeletedFrame?.(PNG)
		const deletedFrameStatus = await waitForStatus(deletedFrameService, deletedFrame.jobId)
		assert.equal(deletedFrameStatus.status, 'completed', JSON.stringify(deletedFrameStatus))
		assert.equal(
			store.getBoard(canvasId).shapes.some((shape) => shape.id === 'frame'),
			false,
		)
		assert.equal(
			store.getBoard(canvasId).shapes.some((shape) => shape.id === deletedFrame.shapeId),
			true,
		)
	})
})

test('completion pins to the original canvas and deleted canvas fails safely', async () => {
	await withStore(async (store) => {
		const original = store.createCanvas('Original')
		const other = store.createCanvas('Other')
		let resolveGenerator: ((bytes: Uint8Array) => void) | undefined
		const service = new ImageGenerationService(store, () => {}, {
			generator: () =>
				new Promise<Uint8Array>((resolve) => {
					resolveGenerator = resolve
				}),
		})
		const started = service.start({
			prompt: 'Pinned to original',
			aspect: '2:3',
			canvasId: original.canvas.id,
			x: 500,
			y: 500,
			width: 200,
		})
		store.activateCanvas(other.canvas.id)
		resolveGenerator?.(PNG)
		const completed = await waitForStatus(service, started.jobId)
		assert.equal(completed.status, 'completed')
		assert.equal(
			store.getBoard(original.canvas.id).shapes.some((shape) => shape.id === started.shapeId),
			true,
		)
		assert.equal(
			store.getBoard(other.canvas.id).shapes.some((shape) => shape.id === started.shapeId),
			false,
		)

		let resolveDeleted: ((bytes: Uint8Array) => void) | undefined
		const deletedService = new ImageGenerationService(store, () => {}, {
			generator: () =>
				new Promise<Uint8Array>((resolve) => {
					resolveDeleted = resolve
				}),
		})
		const deleted = deletedService.start({
			prompt: 'Deleted canvas',
			aspect: '1:1',
			canvasId: original.canvas.id,
			x: 900,
			y: 900,
			width: 200,
		})
		store.deleteCanvas(original.canvas.id)
		resolveDeleted?.(PNG)
		const failed = await waitForStatus(deletedService, deleted.jobId)
		assert.equal(failed.status, 'failed')
		assert.equal((failed as { code: string }).code, 'NOT_FOUND')
	})
})

test('chat and MOSS expose the native generation and status tools', async () => {
	await withStore(async (store) => {
		const service = new ImageGenerationService(store, () => {}, {
			generator: async () => PNG,
		})
		const canvasId = store.getActiveCanvasId()
		const tools = createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId,
			imageGeneration: service,
		})
		const started = (await runTool(tools.generate_image, {
			prompt: 'A simple diagram',
			aspect: '1:1',
			x: 500,
			y: 500,
			width: 200,
		})) as Record<string, unknown>
		assert.equal(started.status, 'pending')
		const jobId = started.jobId as string
		const final = await waitForStatus(service, jobId)
		assert.equal(final.status, 'completed')
		const status = (await runTool(tools.image_generation_status, { jobId })) as Record<
			string,
			unknown
		>
		assert.equal(status.status, 'completed')

		const session = await createMossSession(store, () => {}, { canvasId, selection: [] }, service)
		assert.ok(session.tools.some((tool) => tool.name === 'generate_image'))
		assert.ok(session.tools.some((tool) => tool.name === 'image_generation_status'))
		const mossStatus = await executeMossTool(
			store,
			() => {},
			{
				canvasId,
				selection: [],
				revision: store.getBoard(canvasId).revision,
				name: 'image_generation_status',
				input: { jobId },
			},
			service,
		)
		assert.equal((mossStatus.result as { status: string }).status, 'completed')
	})
})
