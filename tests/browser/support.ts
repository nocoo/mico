import { type APIRequestContext, type BrowserContext, expect, type Page } from '@playwright/test'
import type { Board, CanvasShape, Shape } from '../../src/shared/types'

export const ISOLATED_ORIGIN = 'http://127.0.0.1:27063'

export type AssistantTab = 'Chat' | 'Audio' | 'Live' | 'Settings'

export async function openAssistant(page: Page, tab: AssistantTab) {
	const panelElement = page.locator('#ai-panel')
	if ((await panelElement.getAttribute('aria-hidden')) === 'true') {
		await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click()
	}
	await expect(panelElement).toBeVisible()
	const panel = page.getByRole('region', { name: 'AI assistant' })
	await panel.getByRole('tab', { name: tab, exact: true }).click()
	await expect(panel.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	return panel
}

export async function closeAssistant(page: Page) {
	const panel = page.locator('#ai-panel')
	if ((await panel.getAttribute('aria-hidden')) !== 'true') {
		await page.getByRole('button', { name: 'Close AI assistant', exact: true }).click()
	}
	await expect(panel).toBeHidden()
	await page.locator('#ai-panel, .toolbar').evaluateAll(async (elements) => {
		await Promise.all(
			elements
				.flatMap((element) => element.getAnimations())
				.map((animation) => animation.finished.catch(() => undefined)),
		)
	})
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	)
}

export type MicrophoneMockMode = 'allowed' | 'denied' | 'delayed'

export interface MicrophoneMockState {
	mode: MicrophoneMockMode
	requested: number
	activeTracks: number
	stopped: number
	resolve?: () => Promise<void>
}

export interface MaiMockState {
	sessionUpdates: number
	appends: number
	commits: number
	completed: number
	closed: boolean
	messages: unknown[]
}

export async function installMicrophoneMock(
	context: BrowserContext,
	mode: MicrophoneMockMode = 'allowed',
): Promise<void> {
	if (mode !== 'denied') {
		await context.grantPermissions(['microphone'], { origin: ISOLATED_ORIGIN })
	}
	await context.addInitScript(
		({ mode }) => {
			const state = {
				mode,
				requested: 0,
				activeTracks: 0,
				stopped: 0,
			} as MicrophoneMockState
			Object.assign(globalThis, { __micoMicrophoneMock: state })

			let media = navigator.mediaDevices
			if (!media) {
				Object.defineProperty(navigator, 'mediaDevices', {
					configurable: true,
					value: {},
				})
				media = navigator.mediaDevices
			}

			const trackCleanup = new WeakMap<MediaStreamTrack, () => void>()
			const wrapStream = (stream: MediaStream) => {
				state.activeTracks += stream.getTracks().length
				for (const track of stream.getTracks()) {
					const originalStop = track.stop.bind(track)
					let stopped = false
					track.stop = () => {
						if (!stopped) {
							stopped = true
							state.stopped++
							state.activeTracks = Math.max(0, state.activeTracks - 1)
							trackCleanup.get(track)?.()
						}
						originalStop()
					}
				}
				return stream
			}

			const createFakeStream = async () => {
				const context = new AudioContext({ sampleRate: 16000 })
				if (context.state === 'suspended') await context.resume()
				const oscillator = context.createOscillator()
				const gain = context.createGain()
				const destination = context.createMediaStreamDestination()
				oscillator.frequency.value = 440
				for (let time = 0; time < 60; time += 1.4) {
					gain.gain.setValueAtTime(0.1, context.currentTime + time)
					gain.gain.setValueAtTime(0, context.currentTime + time + 0.7)
				}
				oscillator.connect(gain)
				gain.connect(destination)
				oscillator.start()
				const stream = wrapStream(destination.stream)
				for (const track of stream.getTracks()) {
					trackCleanup.set(track, () => {
						oscillator.stop()
						void context.close()
					})
				}
				return stream
			}

			if (mode === 'denied') {
				media.getUserMedia = () =>
					Promise.reject(new DOMException('Microphone permission denied', 'NotAllowedError'))
				return
			}

			if (mode === 'delayed') {
				media.getUserMedia = () => {
					state.requested++
					return new Promise<MediaStream>((resolve, reject) => {
						state.resolve = async () => {
							try {
								resolve(await createFakeStream())
							} catch (error) {
								reject(error)
							}
						}
					})
				}
				return
			}

			media.getUserMedia = async () => {
				state.requested++
				return createFakeStream()
			}
		},
		{ mode },
	)
}

export async function mockMaiTranscription(
	page: Page,
	transcript = 'Draw projectile motion',
): Promise<MaiMockState> {
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

	const state: MaiMockState = {
		sessionUpdates: 0,
		appends: 0,
		commits: 0,
		completed: 0,
		closed: false,
		messages: [],
	}

	await page.routeWebSocket(/\/mai\/realtime(?:\?.*)?$/, (socket) => {
		const complete = () => {
			state.completed++
			socket.send(
				JSON.stringify({
					type: 'conversation.item.input_audio_transcription.completed',
					transcript,
				}),
			)
		}

		socket.onMessage((message) => {
			const payload = JSON.parse(String(message)) as { type?: string }
			state.messages.push(payload)
			if (payload.type === 'session.update') {
				state.sessionUpdates++
				socket.send(JSON.stringify({ type: 'session.updated' }))
				return
			}
			if (payload.type === 'input_audio_buffer.append') {
				state.appends++
				if (state.appends === 1) {
					socket.send(
						JSON.stringify({
							type: 'conversation.item.input_audio_transcription.delta',
							delta: transcript,
						}),
					)
					socket.send(
						JSON.stringify({
							type: 'conversation.item.input_audio_transcription.intermediate',
							intermediate: 'Draw projectile motion',
						}),
					)
				}
				return
			}
			if (payload.type === 'input_audio_buffer.commit') {
				state.commits++
				complete()
			}
		})
		socket.onClose(() => {
			state.closed = true
		})
	})

	return state
}

export async function board(request: APIRequestContext): Promise<Board> {
	const response = await request.get('/api/board')
	expect(response.ok()).toBe(true)
	return response.json()
}

export async function resetBoard(request: APIRequestContext, shapes: Shape[] = []): Promise<Board> {
	const current = await board(request)
	const response = await request.post('/api/operations', {
		data: {
			expectedRevision: current.revision,
			operations: [
				...current.shapes.map((shape) => ({ type: 'delete', id: shape.id })),
				...shapes.map((shape) => ({ type: 'create', shape })),
			],
		},
	})
	expect(response.ok()).toBe(true)
	return response.json()
}

export async function shapeOf(request: APIRequestContext, id: string): Promise<CanvasShape> {
	const shape = (await board(request)).shapes.find((candidate) => candidate.id === id)
	if (!shape || shape.type === 'connector') throw new Error(`Missing canvas shape ${id}`)
	return shape
}

export async function choose(page: Page, label: string, option: string) {
	await page.getByRole('combobox', { name: label, exact: true }).click()
	await page.getByRole('option', { name: option, exact: true }).click()
}

export async function worldView(page: Page) {
	return page.locator('[data-world-layer]').evaluate((element) => {
		const matrix = (element as SVGGElement).transform.baseVal.consolidate()?.matrix
		if (!matrix) throw new Error('Missing world transform')
		return { x: matrix.e, y: matrix.f, zoom: matrix.a }
	})
}

export async function worldPoint(page: Page, x: number, y: number) {
	const view = await worldView(page)
	return { x: view.x + x * view.zoom, y: view.y + y * view.zoom }
}

export async function worldScale(page: Page): Promise<number> {
	return (await worldView(page)).zoom
}

export async function resetView(page: Page) {
	await page.getByRole('button', { name: 'Reset view' }).click()
}

export async function dragWorld(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	steps = 8,
) {
	const start = await worldPoint(page, from.x, from.y)
	const end = await worldPoint(page, to.x, to.y)
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(end.x, end.y, { steps })
	await page.mouse.up()
}

export async function clickWorld(page: Page, x: number, y: number) {
	const point = await worldPoint(page, x, y)
	await page.mouse.click(point.x, point.y)
}

export async function pillBox(page: Page, id: string) {
	const box = await page
		.locator(
			`[data-card-handle="${id}"] .canvas-frame-label, [data-card-handle="${id}"] .card-pill`,
		)
		.boundingBox()
	if (!box) throw new Error(`Missing label for ${id}`)
	return box
}

export async function clickPathInk(page: Page, id: string) {
	const point = await page
		.locator(`[data-shape-id="${id}"] path`)
		.first()
		.evaluate((element) => {
			const shape = element as SVGPathElement
			const local = shape.getPointAtLength(shape.getTotalLength() / 2)
			const screen = new DOMPoint(local.x, local.y).matrixTransform(
				shape.getScreenCTM() ?? undefined,
			)
			return { x: screen.x, y: screen.y }
		})
	await page.mouse.click(point.x, point.y)
}

export const colors = {
	blue: '#3b82f6',
	green: '#22c55e',
	yellow: '#facc15',
	pink: '#f472b6',
	ink: '#263248',
	noteYellow: '#fef3c7',
}
