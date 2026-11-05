import { expect, type Page, test } from '@playwright/test'

const AI_BUTTON = 'AI assistant'
const OPEN_AI = 'Open AI assistant'

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
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.completed',
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
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Audio' }).click()
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

test('Audio defaults to a 1000 ms silence cut and accepts 1000 in the range', async ({ page }) => {
	const mock = state()
	const { prerecorded } = await openAudio(page, mock)
	const silence = prerecorded.getByRole('slider').first()
	await expect(silence).toHaveValue('1000')
	await expect(silence).toHaveAttribute('max', '1000')
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
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Audio' }).click()
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
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.completed',
						event_id: payload.event_id,
						transcript: 'Sub-100ms real speech',
					}),
				)
			}
		})
	})
	await page.goto('/')
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Audio' }).click()
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
				if (mock.commits === 1) return
				socket.send(
					JSON.stringify({
						type: 'error',
						event_id: payload.event_id,
						error: {
							code: 'input_audio_buffer_commit_empty',
							message: 'Input audio buffer is empty.',
						},
					}),
				)
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.completed',
						event_id: 'commit-1-1',
						transcript: 'Earlier real speech',
					}),
				)
			}
		})
	})
	await page.goto('/')
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Audio' }).click()
	const prerecorded = panel.getByRole('tabpanel', { name: 'Audio' })
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(prerecorded.getByText('Earlier real speech', { exact: true })).toBeVisible()
	await expect(prerecorded.getByText('Recording complete', { exact: true })).toBeVisible()
	await expect(
		prerecorded.getByText('Input audio buffer is empty.', { exact: true }),
	).not.toBeVisible()
	await expect.poll(() => mock.commits).toBe(2)
})

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
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Audio' }).click()
	const prerecorded = panel.getByRole('tabpanel', { name: 'Audio' })
	await prerecorded.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(
		prerecorded.getByText('The transcription provider rejected the audio.', { exact: true }),
	).toBeVisible()
	await expect(
		prerecorded.getByText('Transcription model error', { exact: true }),
	).not.toBeVisible()
})
