import { expect, type Page, test } from '@playwright/test'
import { openAssistant } from './support'

interface AudioMockState {
	sessionUpdates: number
	appends: number
	commits: number
	completed: number
	closed: boolean
	messages: unknown[]
	appendedBytes: number
}

function waveBytes(seconds: number, tone = true): Buffer {
	const rate = 16000
	const frames = Math.floor(seconds * rate)
	const bytes = Buffer.alloc(44 + frames * 2)
	bytes.write('RIFF', 0)
	bytes.writeUInt32LE(36 + frames * 2, 4)
	bytes.write('WAVEfmt ', 8)
	bytes.writeUInt32LE(16, 16)
	bytes.writeUInt16LE(1, 20)
	bytes.writeUInt16LE(1, 22)
	bytes.writeUInt32LE(rate, 24)
	bytes.writeUInt32LE(rate * 2, 28)
	bytes.writeUInt16LE(2, 32)
	bytes.writeUInt16LE(16, 34)
	bytes.write('data', 36)
	bytes.writeUInt32LE(frames * 2, 40)
	for (let index = 0; index < frames; index++) {
		const value = tone ? Math.sin((2 * Math.PI * 220 * index) / rate) * 12000 : 0
		bytes.writeInt16LE(Math.round(value), 44 + index * 2)
	}
	return bytes
}

function mixedWaveBytes(seconds: number, toneSeconds: [number, number][]): Buffer {
	const rate = 16000
	const frames = Math.floor(seconds * rate)
	const bytes = Buffer.alloc(44 + frames * 2)
	bytes.write('RIFF', 0)
	bytes.writeUInt32LE(36 + frames * 2, 4)
	bytes.write('WAVEfmt ', 8)
	bytes.writeUInt32LE(16, 16)
	bytes.writeUInt16LE(1, 20)
	bytes.writeUInt16LE(1, 22)
	bytes.writeUInt32LE(rate, 24)
	bytes.writeUInt32LE(rate * 2, 28)
	bytes.writeUInt16LE(2, 32)
	bytes.writeUInt16LE(16, 34)
	bytes.write('data', 36)
	bytes.writeUInt32LE(frames * 2, 40)
	for (let index = 0; index < frames; index++) {
		const time = index / rate
		const voiced = toneSeconds.some(([start, end]) => time >= start && time < end)
		const value = voiced ? Math.sin((2 * Math.PI * 220 * index) / rate) * 12000 : 0
		bytes.writeInt16LE(Math.round(value), 44 + index * 2)
	}
	return bytes
}

async function openAudio(page: Page, state: AudioMockState) {
	await page.route('**/mai/config', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				host: 'browser-mock.test',
				deployment: 'browser-mock',
				localPath: '/mai/realtime',
			}),
		}),
	)
	await page.route('**/evals/manifest.json', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				evals: [
					{
						id: 'audio-mock',
						lang: 'en',
						subject: 'Test',
						title: 'Deterministic audio playback',
						voice: 'mock',
						audio: 'audio-mock.wav',
						duration: 0.6,
					},
				],
			}),
		}),
	)
	await page.route('**/evals/audio-mock.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: waveBytes(0.6) }),
	)
	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		socket.onMessage((message) => {
			const payload = JSON.parse(String(message)) as { type?: string; audio?: string }
			state.messages.push(payload)
			if (payload.type === 'session.update') {
				state.sessionUpdates++
				socket.send(JSON.stringify({ type: 'session.updated' }))
				return
			}
			if (payload.type === 'input_audio_buffer.append') {
				state.appends++
				const audio = typeof payload.audio === 'string' ? payload.audio : ''
				state.appendedBytes += audio ? Buffer.from(audio, 'base64').length : 0
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.delta',
						delta: 'Final real speech',
					}),
				)
				return
			}
			if (payload.type === 'input_audio_buffer.commit') {
				state.commits++
				const itemId = `item-${state.commits}`
				socket.send(
					JSON.stringify({
						type: 'input_audio_buffer.committed',
						event_id: `event-ack-${state.commits}`,
						item_id: itemId,
					}),
				)
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.completed',
						event_id: `event-complete-${state.commits}`,
						item_id: itemId,
						transcript: 'Final real speech',
					}),
				)
			}
		})
		socket.onClose(() => {
			state.closed = true
		})
	})

	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	const panel = await openAssistant(page, 'Audio')
	return { panel, prerecorded: panel.getByRole('tabpanel', { name: 'Audio' }) }
}

function state(): AudioMockState {
	return {
		sessionUpdates: 0,
		appends: 0,
		commits: 0,
		completed: 0,
		closed: false,
		messages: [],
		appendedBytes: 0,
	}
}

test('Audio defaults to a 500 ms silence cut and accepts 1000 in the range', async ({ page }) => {
	const mock = state()
	const { prerecorded } = await openAudio(page, mock)
	const silence = prerecorded.getByRole('slider').first()
	await expect(silence).toHaveValue('500')
	await expect(silence).toHaveAttribute('max', '1000')
	await silence.focus()
	await page.keyboard.press('End')
	await expect(silence).toHaveValue('1000')
})

test('post-session recovery repeats both summary writes after a partial failure', async ({
	page,
}) => {
	let summaries = 0
	let retryMessage = ''
	await page.route('**/api/ai/chat', async (route) => {
		const request = route.request().postDataJSON() as {
			mode: string
			messages: { parts: { type: string; text?: string }[] }[]
		}
		if (request.mode !== 'chat') return route.continue()
		summaries++
		retryMessage = request.messages.at(-1)?.parts.find((part) => part.type === 'text')?.text ?? ''
		const chunks: object[] = [
			{ type: 'start', messageId: `summary-${summaries}` },
			{ type: 'start-step' },
			{
				type: 'tool-input-available',
				toolCallId: 'html',
				toolName: 'add_html_cards',
				input: { cards: [] },
			},
			{ type: 'tool-output-available', toolCallId: 'html', output: { ok: true } },
		]
		if (summaries === 1) chunks.push({ type: 'error', errorText: 'Summary interrupted' })
		else {
			chunks.push(
				{
					type: 'tool-input-available',
					toolCallId: 'actions',
					toolName: 'upsert_action_card',
					input: { items: [] },
				},
				{ type: 'tool-output-available', toolCallId: 'actions', output: { ok: true } },
				{ type: 'finish-step' },
				{ type: 'finish', finishReason: 'stop' },
			)
		}
		await route.fulfill({
			status: 200,
			headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
			body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
		})
	})
	const { panel, prerecorded } = await openAudio(page, state())
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(prerecorded.getByText('Recording complete', { exact: true })).toBeVisible()
	await expect.poll(() => summaries).toBe(1)
	await panel.getByRole('tab', { name: 'Chat' }).click()
	await expect(panel.getByRole('alert')).toContainText('Summary interrupted')
	await panel.getByRole('button', { name: 'Continue' }).click()
	await expect.poll(() => summaries).toBe(2)
	expect(retryMessage).toContain('[Post-session summary]')
	await expect(panel.getByRole('alert')).toHaveCount(0)
	await expect(panel.getByRole('button', { name: 'Send message' })).toBeVisible()
	await expect(panel.getByRole('button', { name: 'Create session summary' })).toBeDisabled()
})

test('post-session recovery does not override a newer chat error', async ({ page }) => {
	const requests: string[] = []
	await page.route('**/api/ai/chat', async (route) => {
		const request = route.request().postDataJSON() as {
			mode: string
			messages: { parts: { type: string; text?: string }[] }[]
		}
		if (request.mode !== 'chat') return route.continue()
		requests.push(request.messages.at(-1)?.parts.find((part) => part.type === 'text')?.text ?? '')
		await route.fulfill({ status: 500, json: { error: 'INTERNAL_ERROR', message: 'gateway down' } })
	})
	const { panel, prerecorded } = await openAudio(page, state())
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(prerecorded.getByText('Recording complete', { exact: true })).toBeVisible()
	await expect.poll(() => requests.length).toBe(1)
	await panel.getByRole('tab', { name: 'Chat' }).click()
	await expect(panel.getByRole('alert')).toBeVisible()
	const composer = panel.getByRole('textbox', { name: 'Message the assistant' })
	await composer.fill('Draw a different diagram')
	await composer.press('Enter')
	await expect.poll(() => requests.length).toBe(2)
	await expect(panel.getByRole('alert')).toBeVisible()
	await panel.getByRole('button', { name: 'Continue' }).click()
	await expect.poll(() => requests.length).toBe(3)
	expect(requests[2]).toContain('Continue from the current board')
	expect(requests[2]).not.toContain('[Post-session summary]')
})

test('Audio natural end preserves the final transcript and closes complete', async ({ page }) => {
	const mock = state()
	const { prerecorded } = await openAudio(page, mock)
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect.poll(() => mock.appends).toBeGreaterThan(0)
	await expect.poll(() => mock.commits).toBeGreaterThan(0)
	await expect(prerecorded.getByText('Final real speech', { exact: true }).first()).toBeVisible()
	await expect(prerecorded.getByText('Recording complete', { exact: true })).toBeVisible()
	await expect.poll(() => mock.closed).toBe(true)
})

test('Audio natural end does not commit a terminal short empty silence buffer', async ({
	page,
}) => {
	const mock = state()
	await page.route('**/evals/manifest.json', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				evals: [
					{
						id: 'audio-silent',
						lang: 'en',
						subject: 'Test',
						title: 'Silent terminal buffer',
						voice: 'mock',
						audio: 'audio-silent.wav',
						duration: 0.05,
					},
				],
			}),
		}),
	)
	await page.route('**/evals/audio-silent.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: waveBytes(0.05, false) }),
	)
	await page.route('**/mai/config', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				host: 'browser-mock.test',
				deployment: 'browser-mock',
				localPath: '/mai/realtime',
			}),
		}),
	)
	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		socket.onMessage((message) => {
			const payload = JSON.parse(String(message)) as { type?: string }
			mock.messages.push(payload)
			if (payload.type === 'session.update')
				socket.send(JSON.stringify({ type: 'session.updated' }))
			if (payload.type === 'input_audio_buffer.append') mock.appends++
			if (payload.type === 'input_audio_buffer.commit') mock.commits++
		})
		socket.onClose(() => {
			mock.closed = true
		})
	})
	await page.goto('/')
	const panel = await openAssistant(page, 'Audio')
	const prerecorded = panel.getByRole('tabpanel', { name: 'Audio' })
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(prerecorded.getByText('Recording complete', { exact: true })).toBeVisible()
	expect(mock.commits).toBe(0)
})

test('Audio pads a sub-100ms final voiced tail instead of dropping real speech', async ({
	page,
}) => {
	const mock = state()
	await page.route('**/mai/config', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				host: 'browser-mock.test',
				deployment: 'browser-mock',
				localPath: '/mai/realtime',
			}),
		}),
	)
	await page.route('**/evals/manifest.json', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				evals: [
					{
						id: 'audio-tail',
						lang: 'en',
						subject: 'Test',
						title: 'Sub-100ms voiced tail',
						voice: 'mock',
						audio: 'audio-tail.wav',
						duration: 0.05,
					},
				],
			}),
		}),
	)
	await page.route('**/evals/audio-tail.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: waveBytes(0.05) }),
	)
	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		socket.onMessage((message) => {
			const payload = JSON.parse(String(message)) as {
				type?: string
				audio?: string
				event_id?: string
			}
			mock.messages.push(payload)
			if (payload.type === 'session.update')
				socket.send(JSON.stringify({ type: 'session.updated' }))
			if (payload.type === 'input_audio_buffer.append') {
				mock.appends++
				mock.appendedBytes += payload.audio ? Buffer.from(payload.audio, 'base64').length : 0
			}
			if (payload.type === 'input_audio_buffer.commit') {
				mock.commits++
				const itemId = `item-${mock.commits}`
				socket.send(
					JSON.stringify({
						type: 'input_audio_buffer.committed',
						event_id: `event-ack-${mock.commits}`,
						item_id: itemId,
					}),
				)
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.completed',
						event_id: `event-complete-${mock.commits}`,
						item_id: itemId,
						transcript: 'Sub-100ms real speech',
					}),
				)
			}
		})
	})
	await page.goto('/')
	const panel = await openAssistant(page, 'Audio')
	const prerecorded = panel.getByRole('tabpanel', { name: 'Audio' })
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(prerecorded.getByText('Sub-100ms real speech', { exact: true })).toBeVisible()
	await expect(prerecorded.getByText('Recording complete', { exact: true })).toBeVisible()
	await expect.poll(() => mock.commits).toBe(1)
	await expect.poll(() => mock.appendedBytes).toBeGreaterThanOrEqual(1600)
})

test('Audio correlates an empty final commit and preserves an earlier outstanding transcript', async ({
	page,
}) => {
	const mock = state()
	await page.route('**/mai/config', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				host: 'browser-mock.test',
				deployment: 'browser-mock',
				localPath: '/mai/realtime',
			}),
		}),
	)
	await page.route('**/evals/manifest.json', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				evals: [
					{
						id: 'audio-outstanding',
						lang: 'en',
						subject: 'Test',
						title: 'Empty final commit',
						voice: 'mock',
						audio: 'audio-outstanding.wav',
						duration: 1.85,
					},
				],
			}),
		}),
	)
	await page.route('**/evals/audio-outstanding.wav', (route) =>
		route.fulfill({
			contentType: 'audio/wav',
			body: mixedWaveBytes(1.85, [
				[0, 0.5],
				[1.8, 1.85],
			]),
		}),
	)
	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		socket.onMessage((message) => {
			const payload = JSON.parse(String(message)) as {
				type?: string
				audio?: string
				event_id?: string
			}
			mock.messages.push(payload)
			if (payload.type === 'session.update')
				socket.send(JSON.stringify({ type: 'session.updated' }))
			if (payload.type === 'input_audio_buffer.append') {
				mock.appends++
				mock.appendedBytes += payload.audio ? Buffer.from(payload.audio, 'base64').length : 0
			}
			if (payload.type === 'input_audio_buffer.commit') {
				mock.commits++
				if (mock.commits === 1) {
					socket.send(
						JSON.stringify({
							type: 'input_audio_buffer.committed',
							event_id: 'event-ack-1',
							item_id: 'item-1',
						}),
					)
					return
				}
				socket.send(
					JSON.stringify({
						type: 'error',
						event_id: 'event-server-error-2',
						error: {
							event_id: payload.event_id,
							code: 'input_audio_buffer_commit_empty',
							message: 'Input audio buffer is empty.',
						},
					}),
				)
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.completed',
						event_id: 'event-complete-1',
						item_id: 'item-1',
						transcript: 'Earlier real speech',
					}),
				)
			}
		})
	})
	await page.goto('/')
	const panel = await openAssistant(page, 'Audio')
	const prerecorded = panel.getByRole('tabpanel', { name: 'Audio' })
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(prerecorded.getByText('Earlier real speech', { exact: true })).toBeVisible()
	await expect(prerecorded.getByText('Recording complete', { exact: true })).toBeVisible()
	await expect(
		prerecorded.getByText('Input audio buffer is empty.', { exact: true }),
	).not.toBeVisible()
	await expect.poll(() => mock.commits).toBe(2)
})

test('Audio correlates acknowledged items and releases out-of-order completions in order', async ({
	page,
}) => {
	const mock = state()
	await page.route('**/mai/config', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				host: 'browser-mock.test',
				deployment: 'browser-mock',
				localPath: '/mai/realtime',
			}),
		}),
	)
	await page.route('**/evals/manifest.json', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				evals: [
					{
						id: 'audio-out-of-order',
						lang: 'en',
						subject: 'Test',
						title: 'Out-of-order completion',
						voice: 'mock',
						audio: 'audio-out-of-order.wav',
						duration: 1.8,
					},
				],
			}),
		}),
	)
	await page.route('**/evals/audio-out-of-order.wav', (route) =>
		route.fulfill({
			contentType: 'audio/wav',
			body: mixedWaveBytes(1.8, [
				[0, 0.5],
				[1.7, 1.8],
			]),
		}),
	)
	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		socket.onMessage((message) => {
			const payload = JSON.parse(String(message)) as { type?: string; event_id?: string }
			mock.messages.push(payload)
			if (payload.type === 'session.update')
				socket.send(JSON.stringify({ type: 'session.updated' }))
			if (payload.type !== 'input_audio_buffer.commit') return

			mock.commits++
			const itemId = `item-${mock.commits}`
			socket.send(
				JSON.stringify({
					type: 'input_audio_buffer.committed',
					event_id: `event-ack-${mock.commits}`,
					item_id: itemId,
				}),
			)
			if (mock.commits === 1) return

			socket.send(
				JSON.stringify({
					type: 'conversation.item.input_audio_transcription.completed',
					event_id: 'event-complete-2',
					item_id: 'item-2',
					transcript: 'Later audio',
				}),
			)
			setTimeout(() => {
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.completed',
						event_id: 'event-complete-1',
						item_id: 'item-1',
						transcript: 'Earlier audio',
					}),
				)
			}, 25)
		})
	})
	await page.goto('/')
	const panel = await openAssistant(page, 'Audio')
	const prerecorded = panel.getByRole('tabpanel', { name: 'Audio' })
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()

	const segments = prerecorded.locator('.lesson-segments li')
	await expect(segments).toHaveCount(2)
	await expect(segments.nth(0)).toContainText('Earlier audio')
	await expect(segments.nth(1)).toContainText('Later audio')
	const firstRange = await segments.nth(0).locator('.lesson-seg-time').textContent()
	const secondRange = await segments.nth(1).locator('.lesson-seg-time').textContent()
	const parseRange = (text: string | null) => {
		const match = text?.match(/([\d.]+)–([\d.]+)s/)
		return match ? [Number(match[1]), Number(match[2])] : [Number.NaN, Number.NaN]
	}
	const [firstStart, firstEnd] = parseRange(firstRange)
	const [secondStart, secondEnd] = parseRange(secondRange)
	expect(firstStart).toBe(0)
	expect(firstEnd).toBeGreaterThanOrEqual(0.5)
	expect(firstEnd).toBeLessThan(0.8)
	expect(secondStart).toBeGreaterThanOrEqual(firstEnd)
	expect(secondStart).toBeGreaterThan(0)
	expect(secondEnd).toBeGreaterThanOrEqual(secondStart)
	expect(secondEnd).toBeLessThanOrEqual(1.8)
	await expect(prerecorded.getByText('Recording complete', { exact: true })).toBeVisible()
	await expect.poll(() => mock.commits).toBe(2)
})

for (const fatal of ['error', 'close'] as const) {
	test(`Audio preserves a completed later item before fatal ${fatal}`, async ({ page }) => {
		const mock = state()
		await page.route('**/mai/config', (route) =>
			route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({
					host: 'browser-mock.test',
					deployment: 'browser-mock',
					localPath: '/mai/realtime',
				}),
			}),
		)
		await page.route('**/evals/manifest.json', (route) =>
			route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({
					evals: [
						{
							id: `audio-fatal-${fatal}`,
							lang: 'en',
							subject: 'Test',
							title: `Completed item before ${fatal}`,
							voice: 'mock',
							audio: `audio-fatal-${fatal}.wav`,
							duration: 1.85,
						},
					],
				}),
			}),
		)
		await page.route(`**/evals/audio-fatal-${fatal}.wav`, (route) =>
			route.fulfill({
				contentType: 'audio/wav',
				body: mixedWaveBytes(1.85, [
					[0, 0.5],
					[1.8, 1.85],
				]),
			}),
		)
		let summaryRequests = 0
		page.on('request', (request) => {
			if (request.method() !== 'POST' || !request.url().endsWith('/api/ai/chat')) return
			const body = request.postDataJSON() as { mode?: string }
			if (body.mode === 'chat') summaryRequests++
		})
		await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
			socket.onMessage((message) => {
				const payload = JSON.parse(String(message)) as { type?: string }
				mock.messages.push(payload)
				if (payload.type === 'session.update')
					socket.send(JSON.stringify({ type: 'session.updated' }))
				if (payload.type !== 'input_audio_buffer.commit') return

				mock.commits++
				socket.send(
					JSON.stringify({
						type: 'input_audio_buffer.committed',
						event_id: `event-ack-${mock.commits}`,
						item_id: `item-${mock.commits}`,
					}),
				)
				if (mock.commits === 1) return

				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.completed',
						event_id: 'event-complete-2',
						item_id: 'item-2',
						transcript: 'Completed later audio',
					}),
				)
				if (fatal === 'error') {
					socket.send(
						JSON.stringify({
							type: 'conversation.item.input_audio_transcription.failed',
							event_id: 'event-fatal',
							item_id: 'item-1',
							error: {
								code: 'server_error',
								message: 'The transcription stream failed.',
							},
						}),
					)
				} else {
					void socket.close({ code: 1011, reason: 'test disconnect' })
				}
			})
		})
		await page.goto('/')
		const panel = await openAssistant(page, 'Audio')
		const prerecorded = panel.getByRole('tabpanel', { name: 'Audio' })
		await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()

		await expect(prerecorded.getByText('Completed later audio', { exact: true })).toBeVisible()
		await expect(prerecorded.locator('.lesson-segments li')).toHaveCount(1)
		await expect(prerecorded.getByText('Recording complete', { exact: true })).not.toBeVisible()
		await expect(prerecorded.getByText('Mico is listening', { exact: true })).toBeVisible()
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				),
		)
		await expect.poll(() => summaryRequests).toBe(0)
		await expect(
			prerecorded.getByText(
				fatal === 'error' ? 'The transcription stream failed.' : 'Connection closed 1011',
				{ exact: true },
			),
		).toBeVisible()
		await expect.poll(() => mock.commits).toBe(2)
	})
}

test('Audio shows exact nested provider errors instead of a generic model error', async ({
	page,
}) => {
	const mock = state()
	await page.route('**/mai/config', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				host: 'browser-mock.test',
				deployment: 'browser-mock',
				localPath: '/mai/realtime',
			}),
		}),
	)
	await page.route('**/evals/manifest.json', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				evals: [
					{
						id: 'audio-error',
						lang: 'en',
						subject: 'Test',
						title: 'Provider error',
						voice: 'mock',
						audio: 'audio-error.wav',
						duration: 0.6,
					},
				],
			}),
		}),
	)
	await page.route('**/evals/audio-error.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: waveBytes(0.6) }),
	)
	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		socket.onMessage((message) => {
			const payload = JSON.parse(String(message)) as { type?: string }
			mock.messages.push(payload)
			if (payload.type === 'session.update')
				socket.send(JSON.stringify({ type: 'session.updated' }))
			if (payload.type === 'input_audio_buffer.commit') {
				mock.commits++
				socket.send(
					JSON.stringify({
						type: 'error',
						error: {
							code: 'server_error',
							message: 'The transcription provider rejected the audio.',
						},
					}),
				)
			}
		})
	})
	await page.goto('/')
	const panel = await openAssistant(page, 'Audio')
	const prerecorded = panel.getByRole('tabpanel', { name: 'Audio' })
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(
		prerecorded.getByText('The transcription provider rejected the audio.', { exact: true }),
	).toBeVisible()
	await expect(
		prerecorded.getByText('Transcription model error', { exact: true }),
	).not.toBeVisible()
})
