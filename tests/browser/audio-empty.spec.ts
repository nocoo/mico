import { expect, type Page, test } from '@playwright/test'
import { openAssistant } from './support'

function waveBytes(seconds: number): Buffer {
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
		const value = Math.sin((2 * Math.PI * 220 * index) / rate) * 12000
		bytes.writeInt16LE(Math.round(value), 44 + index * 2)
	}
	return bytes
}

async function openAudioWithManifest(page: Page, evals: unknown[]) {
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
		route.fulfill({ contentType: 'application/json', body: JSON.stringify({ evals }) }),
	)
	await page.goto('/')
	const panel = await openAssistant(page, 'Audio')
	return panel.getByRole('tabpanel', { name: 'Audio' })
}

const recording = {
	id: 'audio-state',
	lang: 'en',
	subject: 'Test',
	title: 'Audio state lifecycle',
	voice: 'mock',
	audio: 'audio-state.wav',
	duration: 1.8,
}

test('Audio distinguishes an empty library without pretending playback is active', async ({
	page,
}) => {
	const audio = await openAudioWithManifest(page, [])

	await expect(audio.getByText('No recordings available', { exact: true }).first()).toBeVisible()
	await expect(
		audio.getByText('No recording is available for playback.', { exact: true }),
	).toBeVisible()
	await expect(audio.getByRole('button', { name: 'Play recording', exact: true })).toBeDisabled()
	await expect(audio.locator('.lesson-ai')).toHaveCount(0)
	await expect(audio.locator('.lesson-caret')).toHaveCount(0)
	await expect(audio.locator('.lesson-seg-empty svg')).toHaveCount(0)
	await expect(audio.getByText(/waiting for|listening/i)).toHaveCount(0)
})

test('Audio presents ready, playing, paused and complete from real playback state', async ({
	page,
}, testInfo) => {
	await page.route('**/evals/audio-state.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: waveBytes(recording.duration) }),
	)
	let commit = 0
	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		socket.onMessage((message) => {
			const payload = JSON.parse(String(message)) as { type?: string }
			if (payload.type === 'session.update') {
				socket.send(JSON.stringify({ type: 'session.updated' }))
				return
			}
			if (payload.type !== 'input_audio_buffer.commit') return
			commit++
			const itemId = `audio-state-${commit}`
			socket.send(
				JSON.stringify({
					type: 'input_audio_buffer.committed',
					event_id: `audio-ack-${commit}`,
					item_id: itemId,
				}),
			)
			socket.send(
				JSON.stringify({
					type: 'conversation.item.input_audio_transcription.completed',
					event_id: `audio-complete-${commit}`,
					item_id: itemId,
					transcript: 'Deterministic audio',
				}),
			)
		})
	})

	const audio = await openAudioWithManifest(page, [recording])
	await expect(audio.getByText('Ready to play', { exact: true })).toBeVisible()
	await expect(audio.locator('.lesson-dot')).toHaveAttribute('data-kind', 'ok')
	await expect(
		audio.getByText('Press Play recording to begin transcription.', { exact: true }),
	).toBeVisible()
	await expect(audio.getByRole('button', { name: 'Restart', exact: true })).toBeDisabled()
	await expect(audio.locator('.lesson-ai')).toHaveCount(0)
	await expect(audio.locator('.lesson-caret')).toHaveCount(0)
	await expect(audio.locator('.lesson-seg-empty svg')).toHaveCount(0)
	await expect(audio.getByText(/waiting for|listening/i)).toHaveCount(0)
	await page.screenshot({ path: testInfo.outputPath('audio-ready.png'), fullPage: true })

	await audio.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(audio.getByText('Playing recording', { exact: true })).toBeVisible()
	await expect(audio.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
	await expect(audio.getByText('Transcribing the recording…', { exact: true })).toBeVisible()
	await expect(audio.locator('.lesson-caret')).toHaveCount(1)
	await page.screenshot({ path: testInfo.outputPath('audio-playing.png'), fullPage: true })

	await audio.getByRole('button', { name: 'Pause', exact: true }).click()
	await expect(audio.getByText('Paused', { exact: true })).toBeVisible()
	await expect(audio.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
	await expect(
		audio.getByText('Playback paused. Resume to continue transcription.', { exact: true }),
	).toBeVisible()
	await expect(audio.locator('.lesson-caret')).toHaveCount(0)
	await page.screenshot({ path: testInfo.outputPath('audio-paused.png'), fullPage: true })

	await audio.getByRole('button', { name: 'Resume', exact: true }).click()
	await expect(audio.getByText('Recording complete', { exact: true })).toBeVisible()
	await expect(audio.getByRole('button', { name: 'Play again', exact: true })).toBeVisible()
	await expect(audio.locator('.lesson')).toHaveAttribute('data-phase', 'done')
	await page.screenshot({ path: testInfo.outputPath('audio-complete.png'), fullPage: true })
})

test('Audio can restart while the final transcript is still pending', async ({ page }) => {
	await page.route('**/evals/audio-state.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: waveBytes(recording.duration) }),
	)
	let sessions = 0
	let closed = 0
	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		socket.onClose(() => closed++)
		socket.onMessage((message) => {
			const payload = JSON.parse(String(message)) as { type?: string }
			if (payload.type === 'session.update') {
				sessions++
				socket.send(JSON.stringify({ type: 'session.updated' }))
			}
			if (payload.type === 'input_audio_buffer.commit') {
				socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'pending' }))
			}
		})
	})
	const audio = await openAudioWithManifest(page, [recording])
	await audio.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(audio.locator('.lesson')).toHaveAttribute('data-phase', 'stopping')
	const restart = audio.getByRole('button', { name: 'Restart', exact: true })
	await expect(restart).toBeEnabled()
	await restart.click()
	await expect.poll(() => sessions).toBeGreaterThanOrEqual(2)
	await expect.poll(() => closed).toBeGreaterThanOrEqual(1)
})

test('Audio resets to ready when creating a canvas fails during setup', async ({ page }) => {
	await page.route('**/evals/audio-state.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: waveBytes(recording.duration) }),
	)
	let updates = 0
	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		socket.onMessage((message) => {
			if (JSON.parse(String(message)).type === 'session.update') updates++
		})
	})
	await page.route('**/api/canvases', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({ status: 503, json: { message: 'Canvas unavailable' } })
			: route.continue(),
	)
	const audio = await openAudioWithManifest(page, [recording])
	await audio.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect.poll(() => updates).toBe(1)
	await expect(audio.locator('.lesson')).toHaveAttribute('data-phase', 'connecting')
	await audio.getByRole('button', { name: 'New canvas', exact: true }).click()
	await expect(audio.locator('.lesson')).toHaveAttribute('data-phase', 'idle')
	await expect(audio.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled()
})

test('Audio exposes a real playback error and offers an honest retry', async ({
	page,
}, testInfo) => {
	await page.route('**/evals/audio-state.wav', (route) =>
		route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }),
	)
	const audio = await openAudioWithManifest(page, [recording])

	await audio.getByRole('button', { name: 'Play recording', exact: true }).click()
	await expect(
		audio.getByText('Audio load failed: Could not load audio: HTTP 503', { exact: true }),
	).toBeVisible()
	await expect(audio.locator('.lesson')).toHaveAttribute('data-phase', 'error')
	await expect(audio.locator('.lesson-dot')).toHaveAttribute('data-kind', 'error')
	await expect(audio.getByRole('button', { name: 'Retry recording', exact: true })).toBeVisible()
	await expect(
		audio.getByText('Playback stopped before a transcript was available.', { exact: true }),
	).toBeVisible()
	await expect(audio.locator('.lesson-ai')).toHaveCount(0)
	await page.screenshot({ path: testInfo.outputPath('audio-error.png'), fullPage: true })
})
