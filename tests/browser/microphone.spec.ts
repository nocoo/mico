import { expect, type Page, test } from '@playwright/test'
import {
	board,
	installMicrophoneMock,
	type MicrophoneMockState,
	mockMaiTranscription,
	openAssistant,
	resetBoard,
} from './support'

const CLOSE_AI = 'Close AI assistant'

async function openLive(page: Page) {
	const panel = await openAssistant(page, 'Live')
	await expect(panel.getByRole('tabpanel', { name: 'Live' })).toBeVisible()
	await panel.getByRole('radio', { name: 'MAI Transcribe' }).click()
	return panel
}

async function microphoneState(page: Page) {
	return page.evaluate(
		() =>
			(globalThis as unknown as { __micoMicrophoneMock: MicrophoneMockState }).__micoMicrophoneMock,
	)
}

test.describe('microphone mode', () => {
	test('permission denial leaves recording stopped', async ({ context, page, request }) => {
		await resetBoard(request, [])
		await installMicrophoneMock(context, 'denied')
		await mockMaiTranscription(page)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

		const panel = await openLive(page)
		const start = panel.getByRole('button', { name: 'Start recording' })
		await start.click()

		await expect(start).toHaveAttribute('aria-pressed', 'false')
		await expect(panel.getByRole('alert')).toContainText('Microphone permission denied')
		await expect(panel.getByText('Listening…')).not.toBeVisible()
	})

	test('start and stop stream transcript to the lecture AI queue', async ({
		context,
		page,
		request,
	}) => {
		await resetBoard(request, [])
		await installMicrophoneMock(context)
		const mai = await mockMaiTranscription(page, 'Draw projectile motion')
		let lectureRequest: { mode?: string; selection?: string[] } | undefined
		await page.route('**/api/ai/chat', async (route) => {
			lectureRequest = route.request().postDataJSON() as {
				mode?: string
				selection?: string[]
			}
			await route.continue()
		})
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

		const panel = await openLive(page)
		const live = panel.getByRole('tabpanel', { name: 'Live' })
		await expect(live.getByRole('switch', { name: 'Include meeting audio' })).toHaveAttribute(
			'aria-checked',
			'false',
		)
		await live.getByRole('button', { name: 'Start recording' }).click()
		await expect(live.getByRole('button', { name: 'Stop recording' })).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		await expect(live.getByText('Listening…')).toBeVisible()
		await expect(live.getByText('Live transcript')).toBeVisible()
		await expect(live.getByText('Tap to end the conversation')).toBeVisible()

		await expect.poll(() => mai.appends).toBeGreaterThan(0)
		await expect.poll(() => mai.completed).toBeGreaterThan(0)
		await expect(live.getByText('Draw projectile motion', { exact: true }).first()).toBeVisible()
		await expect.poll(() => lectureRequest?.mode).toBe('lecture')
		await expect
			.poll(async () => (await board(request)).shapes.length, { timeout: 15_000 })
			.toBeGreaterThanOrEqual(8)

		await live.getByRole('button', { name: 'Stop recording' }).click()
		await expect(panel.getByRole('button', { name: 'Start recording' })).toHaveAttribute(
			'aria-pressed',
			'false',
		)
		await expect.poll(() => mai.commits).toBeGreaterThan(0)
		await expect.poll(() => mai.closed).toBe(true)
		await expect.poll(async () => (await microphoneState(page)).stopped).toBeGreaterThan(0)
	})

	test('stopping commits the last utterance before closing recognition', async ({
		context,
		page,
		request,
	}) => {
		await resetBoard(request, [])
		await installMicrophoneMock(context)
		const mai = await mockMaiTranscription(page, 'Final spoken sentence')
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		const panel = await openLive(page)
		const live = panel.getByRole('tabpanel', { name: 'Live' })
		await expect(live.getByRole('switch', { name: 'Include meeting audio' })).toHaveAttribute(
			'aria-checked',
			'false',
		)
		await live.getByRole('button', { name: 'Start recording' }).click()
		await expect.poll(() => mai.appends).toBeGreaterThanOrEqual(2)
		expect(mai.commits).toBe(0)
		await live.getByRole('button', { name: 'Stop recording' }).click()
		await expect.poll(() => mai.commits).toBeGreaterThan(0)
		await expect(live.getByText('Final spoken sentence', { exact: true })).toBeVisible()
		await expect.poll(() => mai.closed).toBe(true)
		await expect.poll(async () => (await board(request)).shapes.length).toBeGreaterThanOrEqual(8)
	})

	test('switching away from Live releases the microphone and transcription socket', async ({
		context,
		page,
		request,
	}) => {
		await resetBoard(request, [])
		await installMicrophoneMock(context)
		const mai = await mockMaiTranscription(page)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

		const panel = await openLive(page)
		await panel.getByRole('button', { name: 'Start recording' }).click()
		await expect(panel.getByText('Listening…')).toBeVisible()
		await expect.poll(() => mai.appends).toBeGreaterThan(0)

		await panel.getByRole('tab', { name: 'Chat' }).click()
		await expect.poll(() => mai.closed).toBe(true)
		await expect.poll(async () => (await microphoneState(page)).stopped).toBeGreaterThan(0)
		await expect(panel.getByText('Listening…')).not.toBeVisible()
	})

	test('closing the AI panel releases recording', async ({ context, page, request }) => {
		await resetBoard(request, [])
		await installMicrophoneMock(context)
		const mai = await mockMaiTranscription(page)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

		const panel = await openLive(page)
		await panel.getByRole('button', { name: 'Start recording' }).click()
		await expect(panel.getByText('Listening…')).toBeVisible()
		await expect.poll(() => mai.appends).toBeGreaterThan(0)

		await page.getByRole('button', { name: CLOSE_AI, exact: true }).click()
		await expect(panel).toBeHidden()
		await expect.poll(() => mai.closed).toBe(true)
		await expect.poll(async () => (await microphoneState(page)).stopped).toBeGreaterThan(0)
	})

	test('switching canvases releases the microphone', async ({ context, page, request }) => {
		await resetBoard(request, [])
		await installMicrophoneMock(context)
		const mai = await mockMaiTranscription(page)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		const previous = (
			(await (await request.get('/api/state')).json()) as { activeCanvasId: string }
		).activeCanvasId
		const panel = await openLive(page)
		await panel.getByRole('button', { name: 'Start recording' }).click()
		await expect.poll(() => mai.appends).toBeGreaterThan(0)
		const created = await request.post('/api/canvases', {
			data: { name: 'Microphone test', activate: true },
		})
		expect(created.ok()).toBe(true)
		const id = ((await created.json()) as { createdCanvasId: string }).createdCanvasId
		try {
			await expect.poll(async () => (await microphoneState(page)).activeTracks).toBe(0)
			await expect.poll(() => mai.closed).toBe(true)
		} finally {
			await request.put('/api/active-canvas', { data: { id: previous } })
			await request.delete(`/api/canvases/${id}`)
		}
	})

	test('delayed permission is cancelled without opening transcription', async ({
		context,
		page,
		request,
	}) => {
		await resetBoard(request, [])
		await installMicrophoneMock(context, 'delayed')
		const mai = await mockMaiTranscription(page)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

		const panel = await openLive(page)
		await panel.getByRole('button', { name: 'Start recording' }).click()
		await expect.poll(async () => (await microphoneState(page)).requested).toBe(1)

		await panel.getByRole('tab', { name: 'Chat' }).click()
		await page.evaluate(async () => {
			const state = (globalThis as unknown as { __micoMicrophoneMock: MicrophoneMockState })
				.__micoMicrophoneMock
			await state.resolve?.()
		})
		await expect(panel.getByText('Listening…')).not.toBeVisible()
		await expect.poll(() => mai.appends).toBe(0)
		await expect.poll(async () => (await microphoneState(page)).activeTracks).toBe(0)
	})

	test('local audio helper auto-connects, hides browser meeting audio toggle, and streams PCM16', async ({
		context,
		page,
		request,
	}) => {
		await resetBoard(request, [])
		await installMicrophoneMock(context)
		const mai = await mockMaiTranscription(page, 'Helper meeting summary')

		let streamStarted = 0
		let stopMessages = 0
		await page.route('http://127.0.0.1:47065/health', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'access-control-allow-origin': '*' },
				body: JSON.stringify({
					app: 'mico-helper',
					version: '0.1.0',
					platform: 'darwin',
					ready: true,
					capturing: false,
					permissions: { microphone: 'granted', systemAudio: 'granted' },
					activeDevice: 'MacBook Pro Microphone',
					sampleRate: 16000,
					channels: 1,
					encoding: 'pcm_s16le',
				}),
			}),
		)
		await page.routeWebSocket('ws://127.0.0.1:47065/stream', (socket) => {
			streamStarted++
			socket.send(
				JSON.stringify({
					type: 'started',
					sampleRate: 16000,
					channels: 1,
					encoding: 'pcm_s16le',
					device: 'MacBook Pro Microphone',
				}),
			)
			const pcm = Buffer.alloc(3200)
			for (let i = 0; i < 1600; i++) {
				const sample = Math.round(Math.sin((i / 16000) * Math.PI * 2 * 440) * 6000)
				pcm.writeInt16LE(sample, i * 2)
			}
			const interval = setInterval(() => {
				socket.send(pcm)
			}, 90)
			socket.onMessage((message) => {
				const parsed = JSON.parse(String(message)) as { type?: string }
				if (parsed.type === 'stop') {
					stopMessages++
					clearInterval(interval)
					socket.send(pcm.subarray(0, 800))
					socket.send(JSON.stringify({ type: 'stopped' }))
					socket.close({ code: 1000, reason: 'stopped' })
				}
			})
			socket.onClose(() => {
				clearInterval(interval)
			})
		})

		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

		const panel = await openLive(page)
		const live = panel.getByRole('tabpanel', { name: 'Live' })
		await expect(live.locator('.call-helper-card')).toBeVisible()
		await expect(live.locator('.call-helper-card')).toContainText('Mico Helper')
		await expect(live.locator('.call-helper-card')).toContainText('Active')
		await expect(live.locator('.call-helper-card')).toContainText('MacBook Pro Microphone')
		await expect(live.getByRole('switch', { name: 'Include meeting audio' })).toHaveCount(0)

		// Topbar popover must also hide browser meeting audio toggle and display helper status.
		await page.getByRole('button', { name: 'Live mode options' }).click()
		const popover = page.locator('.live-topbar-popover')
		await expect(popover).toBeVisible()
		await expect(popover.locator('.live-topbar-helper-row')).toContainText('Mico Helper')
		await expect(popover.locator('.live-topbar-helper-row')).toContainText('Active')
		await expect(popover.getByRole('switch', { name: 'Include meeting audio' })).toHaveCount(0)
		await page.keyboard.press('Escape')

		// Starting Live uses helper WS and never touches browser getUserMedia.
		await live.getByRole('button', { name: 'Start recording' }).click()
		await expect(live.getByRole('button', { name: 'Stop recording' })).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		await expect.poll(() => streamStarted).toBe(1)
		await expect.poll(() => mai.appends).toBeGreaterThanOrEqual(2)
		expect((await microphoneState(page)).requested).toBe(0)

		await live.getByRole('button', { name: 'Stop recording' }).click()
		await expect.poll(() => stopMessages).toBe(1)
		await expect.poll(() => mai.commits).toBeGreaterThan(0)
		await expect(live.getByText('Helper meeting summary', { exact: true }).first()).toBeVisible()
		await expect.poll(() => mai.closed).toBe(true)
		expect((await microphoneState(page)).requested).toBe(0)
	})

	test('helper needing permissions stays mutually exclusive and opens macOS guide', async ({
		context,
		page,
		request,
	}) => {
		await resetBoard(request, [])
		await installMicrophoneMock(context)
		await mockMaiTranscription(page)

		let openPermissionsCalls = 0
		await page.route('http://127.0.0.1:47065/health', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'access-control-allow-origin': '*' },
				body: JSON.stringify({
					app: 'mico-helper',
					version: '0.1.0',
					platform: 'darwin',
					ready: false,
					capturing: false,
					permissions: { microphone: 'granted', systemAudio: 'denied' },
					activeDevice: 'MacBook Pro Microphone',
					sampleRate: 16000,
					channels: 1,
					encoding: 'pcm_s16le',
				}),
			}),
		)
		await page.route('http://127.0.0.1:47065/open-permissions', (route) => {
			openPermissionsCalls++
			return route.fulfill({
				status: 204,
				headers: { 'access-control-allow-origin': '*' },
			})
		})

		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

		const panel = await openLive(page)
		const live = panel.getByRole('tabpanel', { name: 'Live' })
		await expect(live.locator('.call-helper-card')).toContainText('Setup')
		await expect(live.getByRole('switch', { name: 'Include meeting audio' })).toHaveCount(0)

		await live.getByRole('button', { name: 'Grant access' }).click()
		await expect.poll(() => openPermissionsCalls).toBe(1)

		// Pressing Start recording still must NOT fall back to browser getUserMedia.
		await live.getByRole('button', { name: 'Start recording' }).click()
		await expect.poll(() => openPermissionsCalls).toBe(2)
		await expect(live.getByRole('button', { name: 'Start recording' })).toHaveAttribute(
			'aria-pressed',
			'false',
		)
		expect((await microphoneState(page)).requested).toBe(0)

		// Topbar popover mirrors setup status and hides browser toggle.
		await page.getByRole('button', { name: 'Live mode options' }).click()
		const popover = page.locator('.live-topbar-popover')
		await expect(popover.locator('.live-topbar-helper-row')).toContainText('Setup')
		await expect(popover.getByRole('switch', { name: 'Include meeting audio' })).toHaveCount(0)
		await popover.getByRole('button', { name: 'Grant access' }).click()
		await expect.poll(() => openPermissionsCalls).toBe(3)
	})
})
