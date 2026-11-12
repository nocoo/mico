import { expect, type Locator, type Page, test, type WebSocketRoute } from '@playwright/test'
import {
	board,
	installMicrophoneMock,
	type MicrophoneMockState,
	mockMaiTranscription,
	openAssistant,
	resetBoard,
} from './support'

const CLOSE_AI = 'Close AI assistant'

interface MossOutput {
	callId: string
	output: unknown
}

interface MossMockState {
	connections: number
	ready: number
	attachSession: number
	delegation: number
	sessionUpdates: number
	toolEvents: number
	binaryPackets: number
	closed: boolean
	messages: Record<string, unknown>[]
	outputs: MossOutput[]
	firstAckSent: boolean
	firstContinuations: number
	protocolErrors: string[]
	releaseFirstToolAck: () => void
	disconnectAfterSessionUpdate: boolean
	socket: WebSocketRoute | null
	triggerTool: () => void
	sendPlayback: () => void
	disconnect: () => void
}

async function openLive(page: Page) {
	const panel = await openAssistant(page, 'Live')
	await expect(panel.getByRole('tabpanel', { name: 'Live' })).toBeVisible()
	return panel
}

async function microphoneState(page: Page) {
	return page.evaluate(
		() =>
			(globalThis as unknown as { __micoMicrophoneMock: MicrophoneMockState }).__micoMicrophoneMock,
	)
}

async function mockMoss(page: Page, options: { disconnectAfterSessionUpdate?: boolean } = {}) {
	const state: MossMockState = {
		connections: 0,
		ready: 0,
		attachSession: 0,
		delegation: 0,
		sessionUpdates: 0,
		toolEvents: 0,
		binaryPackets: 0,
		closed: false,
		messages: [],
		outputs: [],
		firstAckSent: false,
		firstContinuations: 0,
		protocolErrors: [],
		releaseFirstToolAck: () => {},
		disconnectAfterSessionUpdate: options.disconnectAfterSessionUpdate ?? false,
		socket: null,
		triggerTool: () => {},
		sendPlayback: () => {},
		disconnect: () => {},
	}

	await page.routeWebSocket(/\/moss(?:\?.*)?$/, (socket) => {
		state.connections++
		state.socket = socket

		state.triggerTool = () => {
			socket.send(
				JSON.stringify({
					action: 'response.function_call_arguments.done',
					data: {
						call_id: 'call-moss-browser-note',
						name: 'add_notes',
						arguments: JSON.stringify({
							notes: [
								{
									id: 'moss-note-browser',
									x: 220,
									y: 180,
									w: 260,
									h: 180,
									text: 'MOSS browser note',
									color: '#f7de4b',
								},
							],
						}),
					},
				}),
			)
		}

		state.sendPlayback = () => {
			const context = {
				run_id: 'moss-browser-run',
				turn_id: 'moss-browser-turn',
				chunk_id: 'moss-browser-chunk',
			}
			socket.send(JSON.stringify({ action: 'response.audio.context', data: context }))
			socket.send(Buffer.alloc(960))
			socket.send(JSON.stringify({ action: 'response.audio.done', data: context }))
		}

		state.disconnect = () => {
			socket.send(
				JSON.stringify({
					action: 'proxy.error',
					message: 'Could not connect to MOSS Live.',
				}),
			)
		}

		state.ready++
		socket.send(JSON.stringify({ action: 'proxy.ready' }))

		socket.onMessage((message) => {
			if (typeof message !== 'string') {
				state.binaryPackets++
				return
			}

			const payload = JSON.parse(message) as {
				action?: string
				delegation?: unknown
				session?: { tools?: unknown[] }
				item?: { type?: string; call_id?: string; output?: unknown }
				response?: { call_ids?: string[] }
			}
			state.messages.push(payload)

			if (payload.action === 'attach_session') {
				state.attachSession++
				if (Object.hasOwn(payload, 'delegation')) state.delegation++
				socket.send(
					JSON.stringify({
						action: 'session_attached',
						data: { delegation: 'none' },
					}),
				)
				return
			}

			if (payload.action === 'session.update') {
				state.sessionUpdates++
				const tools = Array.isArray(payload.session?.tools)
					? payload.session.tools
							.map((tool) =>
								typeof tool === 'object' && tool && 'name' in tool
									? String((tool as { name: unknown }).name)
									: '',
							)
							.filter(Boolean)
					: []
				const sessionUpdated = {
					action: 'session.updated',
					data: { tools },
				}
				socket.send(JSON.stringify(sessionUpdated))
				if (state.disconnectAfterSessionUpdate) state.disconnect()
				return
			}

			if (payload.action === 'conversation.item.create') {
				const item = payload.item
				if (item?.type === 'function_call_output' && item.call_id) {
					state.outputs.push({ callId: item.call_id, output: item.output })
					const acknowledge = () =>
						socket.send(
							JSON.stringify({
								action: 'conversation.item.created',
								data: { item: { type: 'function_call_output', call_id: item.call_id } },
							}),
						)
					if (item.call_id === 'call-moss-browser-note') {
						state.releaseFirstToolAck = () => {
							state.firstAckSent = true
							acknowledge()
						}
					} else acknowledge()
				}
			}

			if (
				payload.action === 'response.create' &&
				payload.response?.call_ids?.includes('call-moss-browser-note')
			) {
				state.firstContinuations++
				if (!state.firstAckSent || state.firstContinuations !== 1) {
					state.protocolErrors.push('First tool continuation was premature or repeated')
					return
				}
				socket.send(
					JSON.stringify({
						action: 'response.function_call_arguments.done',
						data: {
							call_id: 'call-moss-browser-next',
							name: 'add_notes',
							arguments: JSON.stringify({
								notes: [{ id: 'moss-note-next', x: 550, y: 180, text: 'Next drawing step' }],
							}),
						},
					}),
				)
			}

			if (payload.action === 'mic_state') {
				state.toolEvents++
			}
		})

		socket.onClose(() => {
			state.closed = true
		})
	})

	return state
}

async function waitForLive(panel: Locator) {
	await expect(panel.getByText('Listening…')).toBeVisible()
}

test.describe('MOSS Live browser integration', () => {
	test.beforeEach(async ({ request }) => {
		await resetBoard(request, [])
	})

	test('default MOSS is full duplex, executes a real note tool, and acknowledges playback', async ({
		context,
		page,
		request,
	}) => {
		await installMicrophoneMock(context)
		const moss = await mockMoss(page)
		const sessionRequests: Record<string, unknown>[] = []
		const toolRequests: Record<string, unknown>[] = []
		let toolPending = false
		page.on('request', (request) => {
			if (!request.url().includes('/api/moss/session')) return
			const body = request.postDataJSON()
			if (body && typeof body === 'object') sessionRequests.push(body as Record<string, unknown>)
		})
		await page.route('**/api/moss/tool', async (route) => {
			toolRequests.push(route.request().postDataJSON() as Record<string, unknown>)
			toolPending = true
			await new Promise((resolve) => setTimeout(resolve, 900))
			toolPending = false
			await route.continue()
		})

		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		const panel = await openLive(page)
		const mossRadio = panel.getByRole('radio', { name: 'MOSS Live' })
		const maiRadio = panel.getByRole('radio', { name: 'MAI Transcribe' })
		await expect(mossRadio).toHaveAttribute('data-state', 'on')
		await expect(maiRadio).toHaveAttribute('data-state', 'off')

		await panel.getByRole('button', { name: 'Start recording' }).click()
		await waitForLive(panel)
		await expect.poll(() => moss.connections).toBe(1)
		await expect.poll(() => moss.attachSession).toBe(1)
		expect(moss.delegation).toBe(0)
		await expect.poll(() => moss.sessionUpdates).toBe(1)
		await expect.poll(() => moss.binaryPackets).toBeGreaterThan(0)
		await expect.poll(() => sessionRequests.length).toBeGreaterThan(0)

		moss.triggerTool()
		await expect.poll(() => toolPending).toBe(true)
		const packetsWhileToolPending = moss.binaryPackets
		await expect.poll(() => moss.binaryPackets).toBeGreaterThan(packetsWhileToolPending)

		await expect.poll(() => toolRequests.length).toBeGreaterThanOrEqual(1)
		await expect
			.poll(async () => {
				const current = await board(request)
				return current.shapes.find((shape) => shape.id === 'moss-note-browser')
			})
			.toBeTruthy()
		await expect
			.poll(() => moss.outputs.some((item) => item.callId === 'call-moss-browser-note'))
			.toBe(true)
		expect(moss.messages.some((message) => message.action === 'response.create')).toBe(false)
		moss.releaseFirstToolAck()
		const output = moss.outputs.find((item) => item.callId === 'call-moss-browser-note')
		expect(output).toBeTruthy()
		const toolResult = output?.output as string
		const parsedResult = JSON.parse(toolResult) as {
			ok?: boolean
			created?: { id: string; type: string }[]
		}
		expect(parsedResult.ok).toBe(true)
		expect(parsedResult.created).toContainEqual({ id: 'moss-note-browser', type: 'note' })
		await expect
			.poll(() =>
				moss.messages.some(
					(message) =>
						message.action === 'response.create' &&
						JSON.stringify(message.response) ===
							JSON.stringify({ call_ids: ['call-moss-browser-note'] }),
				),
			)
			.toBe(true)
		await expect.poll(() => toolRequests.length).toBe(2)
		await expect
			.poll(async () =>
				(await board(request)).shapes.some((shape) => shape.id === 'moss-note-next'),
			)
			.toBe(true)
		await expect.poll(() => moss.outputs.length).toBe(2)
		await expect
			.poll(() =>
				moss.messages.some(
					(message) =>
						message.action === 'response.create' &&
						JSON.stringify(message.response) ===
							JSON.stringify({ call_ids: ['call-moss-browser-next'] }),
				),
			)
			.toBe(true)
		expect(moss.firstContinuations).toBe(1)
		expect(moss.protocolErrors).toEqual([])

		moss.sendPlayback()
		await expect
			.poll(() => moss.messages.some((message) => message.action === 'playback.chunk.completed'))
			.toBe(true)
		await expect
			.poll(() => moss.messages.some((message) => message.action === 'playback.completed'))
			.toBe(true)

		await panel.getByRole('button', { name: 'Stop recording' }).click()
		await expect(panel.getByRole('button', { name: 'Start recording' })).toHaveAttribute(
			'aria-pressed',
			'false',
		)
		await expect.poll(() => moss.closed).toBe(true)
		await expect.poll(async () => (await microphoneState(page)).stopped).toBeGreaterThan(0)
	})

	test('switching to MAI releases MOSS and starts the legacy transcription stream', async ({
		context,
		page,
	}) => {
		await installMicrophoneMock(context)
		const moss = await mockMoss(page)
		const mai = await mockMaiTranscription(page)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		const panel = await openLive(page)
		await panel.getByRole('button', { name: 'Start recording' }).click()
		await waitForLive(panel)
		await expect.poll(() => moss.binaryPackets).toBeGreaterThan(0)

		await panel.getByRole('radio', { name: 'MAI Transcribe' }).click()
		await expect(panel.getByRole('radio', { name: 'MAI Transcribe' })).toHaveAttribute(
			'data-state',
			'on',
		)
		await expect.poll(() => moss.closed).toBe(true)
		await expect.poll(async () => (await microphoneState(page)).activeTracks).toBe(0)

		await panel.getByRole('button', { name: 'Start recording' }).click()
		await expect(panel.getByText('Listening…')).toBeVisible()
		await expect.poll(() => mai.appends).toBeGreaterThan(0)
		await panel.getByRole('button', { name: 'Stop recording' }).click()
		await expect.poll(() => mai.commits).toBeGreaterThan(0)
		await expect.poll(() => mai.closed).toBe(true)
		await expect.poll(async () => (await microphoneState(page)).stopped).toBeGreaterThan(0)
	})

	test('microphone denial leaves MOSS stopped', async ({ context, page }) => {
		await installMicrophoneMock(context, 'denied')
		const moss = await mockMoss(page)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		const panel = await openLive(page)
		await panel.getByRole('button', { name: 'Start recording' }).click()
		await expect(panel.getByRole('alert')).toContainText('Microphone permission is required')
		await expect(panel.getByRole('button', { name: 'Start recording' })).toHaveAttribute(
			'aria-pressed',
			'false',
		)
		await expect.poll(() => moss.connections).toBe(0)
		await expect.poll(async () => (await microphoneState(page)).activeTracks).toBe(0)
	})

	test('delayed permission cancellation never opens MOSS or a late microphone', async ({
		context,
		page,
	}) => {
		await installMicrophoneMock(context, 'delayed')
		const moss = await mockMoss(page)
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
		await expect.poll(() => moss.connections).toBe(0)
		await expect.poll(async () => (await microphoneState(page)).activeTracks).toBe(0)
	})

	test('closing the AI panel releases MOSS recording and the websocket', async ({
		context,
		page,
	}) => {
		await installMicrophoneMock(context)
		const moss = await mockMoss(page)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		const panel = await openLive(page)
		await panel.getByRole('button', { name: 'Start recording' }).click()
		await waitForLive(panel)
		await expect.poll(() => moss.binaryPackets).toBeGreaterThan(0)

		await page.getByRole('button', { name: CLOSE_AI, exact: true }).click()
		await expect(panel).toBeHidden()
		await expect.poll(() => moss.closed).toBe(true)
		await expect.poll(async () => (await microphoneState(page)).activeTracks).toBe(0)
	})

	test('MOSS session and disconnect errors are shown in the Live UI', async ({ context, page }) => {
		await installMicrophoneMock(context)
		await page.route('**/api/moss/session', (route) =>
			route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({
					error: 'MOSS_SESSION_FAILED',
					message: 'MOSS session unavailable',
				}),
			}),
		)
		await page.goto('/')
		await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
		const panel = await openLive(page)
		await panel.getByRole('button', { name: 'Start recording' }).click()
		await expect(panel.getByRole('alert')).toContainText('MOSS session unavailable')

		await page.unroute('**/api/moss/session')
		const moss = await mockMoss(page, { disconnectAfterSessionUpdate: true })
		await panel.getByRole('button', { name: 'Start recording' }).click()
		await expect(panel.getByRole('alert')).toContainText('Could not connect to MOSS Live.')
		await expect.poll(() => moss.connections).toBe(1)
	})
})
