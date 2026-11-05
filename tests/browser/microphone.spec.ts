import { expect, type Page, test } from '@playwright/test'
import {
	board,
	installMicrophoneMock,
	type MicrophoneMockState,
	mockMaiTranscription,
	resetBoard,
} from './support'

const AI_BUTTON = 'AI assistant'
const OPEN_AI = 'Open AI assistant'
const CLOSE_AI = 'Close AI assistant'

async function openLive(page: Page) {
	await page.getByRole('button', { name: OPEN_AI, exact: true }).click()
	const panel = page.getByRole('region', { name: AI_BUTTON })
	await panel.getByRole('tab', { name: 'Live' }).click()
	await expect(panel.getByRole('tabpanel', { name: 'Live' })).toBeVisible()
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
})
