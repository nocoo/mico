import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { createDaemon } from '../src/server/index.ts'
import { ALLOWED_ORIGINS } from '../src/shared/config.ts'

export async function verifyManagedAi({
	pcm,
	confirmProviderUsage,
}: {
	pcm: Buffer
	confirmProviderUsage: boolean
}) {
	if (!confirmProviderUsage) throw new Error('Explicit provider-usage confirmation is required')
	if (
		process.env.MICO_AI_AUTH_MODE !== 'managed-identity' ||
		process.env.MICO_AI_ENABLED !== 'true'
	) {
		throw new Error('Run this check in the managed-identity AI deployment')
	}
	if (process.env.MICO_MOSS_ENABLED !== 'false') throw new Error('MOSS must be explicitly disabled')
	if (!pcm.length || pcm.length % 2 || pcm.length > 20 * 16000 * 2) {
		throw new Error('Provide at most 20 seconds of mono 16 kHz PCM16 audio')
	}
	const directory = mkdtempSync(join(tmpdir(), 'mico-managed-check-'))
	let daemon: ReturnType<typeof createDaemon> | undefined
	let origin = ''
	let voice: WebSocket | undefined
	try {
		daemon = createDaemon({
			port: 0,
			dbPath: join(directory, 'board.sqlite'),
			settingsPath: join(directory, 'settings.json'),
			staticDir: process.env.MICO_STATIC_DIR,
			env: { ...process.env, MICO_AUTH_MODE: 'none', MICO_PUBLIC_ORIGIN: '' },
		})
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening', { signal: AbortSignal.timeout(5000) })
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		origin = `http://127.0.0.1:${address.port}`
		ALLOWED_ORIGINS.add(origin)
		const headers = { Origin: origin, 'Content-Type': 'application/json' }
		const settings = await fetch(`${origin}/api/ai/settings`, { signal: AbortSignal.timeout(5000) })
		const publicSettings = await settings.json()
		assert.equal(publicSettings.authMode, 'managed-identity')
		assert.equal(publicSettings.hasApiKey, false)
		assert.equal(publicSettings.readOnly, true)
		const models = await fetch(`${origin}/api/ai/models`, { signal: AbortSignal.timeout(30000) })
		assert.equal(models.status, 200)
		await models.arrayBuffer()
		const canvasId = await daemon.store.getActiveCanvasId()
		const chat = await fetch(`${origin}/api/ai/chat`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				canvasId,
				selection: [],
				messages: [
					{
						id: 'managed-check',
						role: 'user',
						parts: [
							{
								type: 'text',
								text: 'Create two short text labels on this empty canvas: Managed Identity and MAI ready. Use canvas tools, do not generate images, then reply DONE.',
							},
						],
					},
				],
			}),
			signal: AbortSignal.timeout(90000),
		})
		assert.equal(chat.status, 200)
		const stream = await chat.text()
		assert.ok(!stream.includes('"type":"error"'), 'Chat returned a stream error')
		const created = await daemon.store.getBoard(canvasId)
		assert.ok(created.shapes.length >= 2, 'Chat did not persist the requested canvas content')
		const labels = created.shapes
			.flatMap((shape) => [
				'text' in shape ? shape.text : '',
				'title' in shape ? shape.title : '',
				'label' in shape ? shape.label : '',
			])
			.join(' ')
			.toLowerCase()
			.replace(/\s+/g, '')
		assert.ok(
			labels.includes('managedidentity') && labels.includes('maiready'),
			'Chat did not write the requested labels',
		)
		const voiceResult = await new Promise<{ transcript: string; intermediateEvents: number }>(
			(resolveVoice, reject) => {
				let settled = false
				let ready = false
				let intermediateEvents = 0
				voice = new WebSocket(`${origin.replace('http:', 'ws:')}/mai/realtime`, { origin })
				const socket = voice
				const timer = setTimeout(() => finish(new Error('MAI transcription timed out')), 90000)
				function finish(error?: Error, transcript = '') {
					if (settled) return
					settled = true
					clearTimeout(timer)
					socket.close()
					if (error) reject(error)
					else resolveVoice({ transcript, intermediateEvents })
				}
				socket.on('error', () => finish(new Error('MAI connection failed')))
				socket.on('close', () => {
					if (!settled) finish(new Error('MAI closed before transcription completed'))
				})
				socket.on('open', () =>
					socket.send(
						JSON.stringify({
							type: 'session.update',
							session: {
								type: 'transcription',
								audio: {
									input: {
										format: { type: 'audio/pcm', rate: 16000 },
										transcription: { model: process.env.AZURE_OPENAI_DEPLOYMENT, language: 'en' },
										turn_detection: null,
										noise_reduction: null,
									},
								},
							},
						}),
					),
				)
				socket.on('message', (data) => {
					let event: Record<string, unknown>
					try {
						event = JSON.parse(data.toString()) as Record<string, unknown>
					} catch {
						finish(new Error('MAI returned an invalid event'))
						return
					}
					const type = typeof event.type === 'string' ? event.type : ''
					if (event.action === 'proxy.error' || type === 'error' || type.endsWith('.failed')) {
						finish(new Error('MAI returned a provider error'))
						return
					}
					if (type.endsWith('.intermediate') || type.endsWith('.delta')) intermediateEvents++
					if (type === 'session.updated' && !ready) {
						ready = true
						void (async () => {
							for (let offset = 0; offset < pcm.length && !settled; offset += 3200) {
								socket.send(
									JSON.stringify({
										type: 'input_audio_buffer.append',
										audio: pcm.subarray(offset, offset + 3200).toString('base64'),
									}),
								)
								await new Promise((resolveTick) => setTimeout(resolveTick, 100))
							}
							if (!settled) socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
						})().catch(() => finish(new Error('Could not send test audio')))
					}
					if (type === 'conversation.item.input_audio_transcription.completed') {
						finish(undefined, typeof event.transcript === 'string' ? event.transcript : '')
					}
				})
			},
		)
		assert.ok(voiceResult.transcript.trim().length > 10, 'MAI returned an empty transcription')
		assert.ok(voiceResult.intermediateEvents > 0, 'MAI returned no partial transcription events')
		const beforeLecture = await daemon.store.getBoard(canvasId)
		const beforeRevision = beforeLecture.revision
		const previousIds = new Set(beforeLecture.shapes.map((shape) => shape.id))
		const lecture = await fetch(`${origin}/api/ai/chat`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				canvasId,
				mode: 'lecture',
				selection: [],
				messages: [
					{
						id: 'transcription-check',
						role: 'user',
						parts: [
							{
								type: 'text',
								text: `Summarize this confirmed test transcript in one short note on the canvas. Do not generate images. Transcript: ${voiceResult.transcript}`,
							},
						],
					},
				],
			}),
			signal: AbortSignal.timeout(90000),
		})
		assert.equal(lecture.status, 200)
		assert.ok(!(await lecture.text()).includes('"type":"error"'), 'Lecture returned a stream error')
		const afterLecture = await daemon.store.getBoard(canvasId)
		assert.ok(
			afterLecture.revision > beforeRevision &&
				afterLecture.shapes.some(
					(shape) =>
						shape.type === 'note' &&
						!previousIds.has(shape.id) &&
						(shape.text?.trim().length ?? 0) > 0,
				),
			'Lecture did not persist the requested new note',
		)
		for (const route of ['/api/moss/session', '/api/moss/tool']) {
			const response = await fetch(`${origin}${route}`, {
				method: 'POST',
				headers,
				body: '{}',
				signal: AbortSignal.timeout(5000),
			})
			assert.equal(response.status, 503)
			assert.equal((await response.json()).error, 'MOSS_DISABLED')
		}
		return {
			status: 'passed',
			authMode: 'managed-identity',
			chatModel: publicSettings.model,
			shapes: (await daemon.store.getBoard(canvasId)).shapes.length,
			audioSeconds: pcm.length / 32000,
			...voiceResult,
			mossDisabled: true,
			storage: 'isolated temporary database',
		}
	} finally {
		voice?.terminate()
		await daemon?.close()
		if (origin) ALLOWED_ORIGINS.delete(origin)
		rmSync(directory, { recursive: true, force: true })
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const audioIndex = process.argv.indexOf('--audio')
	if (
		!process.argv.includes('--confirm-provider-usage') ||
		audioIndex < 0 ||
		!process.argv[audioIndex + 1]
	) {
		console.error(
			'Usage: node scripts/verify-managed-ai.ts --confirm-provider-usage --audio <pcm16-file>',
		)
		process.exitCode = 1
	} else {
		try {
			console.log(
				JSON.stringify(
					await verifyManagedAi({
						pcm: readFileSync(process.argv[audioIndex + 1]),
						confirmProviderUsage: true,
					}),
				),
			)
		} catch (error) {
			console.error(error instanceof Error ? error.message : 'Managed AI verification failed')
			process.exitCode = 1
		}
	}
}
