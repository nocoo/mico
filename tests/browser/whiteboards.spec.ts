import { expect, test } from '@playwright/test'
import { board, ISOLATED_ORIGIN, openAssistant, resetBoard } from './support'

test.beforeEach(({ baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to use a non-isolated whiteboard')
})

test('demo presenters can draw, create and switch canvases while retaining their profile', async ({
	page,
	request,
}) => {
	await resetBoard(request, [])
	await page.route('/api/runtime', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				auth: { mode: 'demo' },
				aiEnabled: false,
				aiSettingsVisible: false,
				mossEnabled: false,
				ephemeral: false,
			}),
		}),
	)
	await page.goto('/?sharer=true')
	await expect(page.locator('.whiteboard-cursors')).toHaveCount(1)
	await expect(page.getByRole('button', { name: 'Workspace profile' })).toBeVisible()
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await page.mouse.click(500, 400)
	await expect
		.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'note'))
		.toBe(true)
	const initial = await (await request.get('/api/state')).json()
	const original = initial.canvases.find(
		(canvas: { id: string }) => canvas.id === initial.activeCanvasId,
	)
	const noteId = initial.board.shapes.find((shape: { type: string }) => shape.type === 'note').id
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	await page.getByRole('button', { name: 'New canvas', exact: true }).click()
	await expect
		.poll(async () => (await (await request.get('/api/state')).json()).activeCanvasId)
		.not.toBe(initial.activeCanvasId)
	const created = await (await request.get('/api/state')).json()
	expect(created.canvases).toHaveLength(initial.canvases.length + 1)
	expect(created.board.shapes).toHaveLength(0)
	await expect(page.getByRole('button', { name: 'Workspace profile' })).toBeVisible()

	await page.getByRole('button', { name: `Open canvas ${original.name}`, exact: true }).click()
	await expect(page.locator(`[data-shape-id="${noteId}"]`)).toHaveCount(1)
	await page.reload()
	await expect(page.locator(`[data-shape-id="${noteId}"]`)).toHaveCount(1)
	await expect(page.getByRole('button', { name: 'Workspace profile' })).toBeVisible()
	expect((await request.delete(`/api/canvases/${created.activeCanvasId}`)).ok()).toBe(true)
})

test('demo guests see the server hint when canvas creation or switching is rejected', async ({
	page,
	request,
}) => {
	await resetBoard(request, [])
	const createdResponse = await request.post('/api/canvases', {
		data: { name: 'Presenter canvas', activate: false },
	})
	expect(createdResponse.ok()).toBe(true)
	const created = await createdResponse.json()
	try {
		await page.route('/api/runtime', async (route) => {
			const response = await route.fetch()
			await route.fulfill({
				json: { ...(await response.json()), auth: { mode: 'demo' }, aiEnabled: false },
			})
		})
		const hint =
			'Only the presenter can create or change demo canvases. Use Workspace profile to become or request presenter.'
		const tokens: string[] = []
		for (const path of ['/api/canvases', '/api/active-canvas']) {
			await page.route(path, async (route) => {
				if (route.request().method() === 'GET') return route.continue()
				tokens.push(route.request().headers()['x-mico-whiteboard'] ?? '')
				await route.fulfill({
					status: 403,
					json: { error: 'WHITEBOARD_READ_ONLY', message: hint },
				})
			})
		}
		await page.goto('/')
		await expect(page.locator('.whiteboard-cursors')).toHaveCount(1)
		await page.getByRole('button', { name: 'Canvases', exact: true }).click()
		await page.getByRole('button', { name: 'New canvas', exact: true }).click()
		await expect(page.getByRole('status')).toHaveText(hint)
		await expect(page.getByRole('status')).toHaveCount(0)
		await page.getByRole('button', { name: 'Open canvas Presenter canvas', exact: true }).click()
		await expect(page.getByRole('status')).toHaveText(hint)
		const unchanged = await (await request.get('/api/state')).json()
		expect(unchanged.activeCanvasId).toBe(created.activeCanvasId)
		expect(unchanged.canvases).toHaveLength(created.canvases.length)
		expect(tokens).toHaveLength(2)
		expect(tokens.every((token) => token.length > 0)).toBe(true)
		await page.keyboard.press('Escape')
		await page.getByLabel('Choose image', { exact: true }).setInputFiles({
			name: 'pixel.png',
			mimeType: 'image/png',
			buffer: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
				'base64',
			),
		})
		await expect
			.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'image'))
			.toBe(true)
	} finally {
		expect((await request.delete(`/api/canvases/${created.createdCanvasId}`)).ok()).toBe(true)
	}
})

test('demo guests cannot drag, open editors, or change controls for protected objects', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		{
			id: 'foreign',
			type: 'note',
			x: 400,
			y: 300,
			w: 200,
			h: 160,
			color: '#fff8d4',
			text: 'Someone else owns this',
		},
	])
	await page.route('**/api/runtime', async (route) => {
		const response = await route.fetch()
		await route.fulfill({
			json: { ...(await response.json()), auth: { mode: 'demo' }, aiEnabled: false },
		})
	})
	const hint =
		'You can only edit or delete your own objects. Ask the presenter for edit access to this canvas.'
	let writes = 0
	page.on('request', (request) => {
		if (request.url().endsWith('/api/operations') && request.method() === 'POST') writes += 1
	})
	await page.goto('/')
	await expect(page.locator('.whiteboard-cursors')).toHaveCount(1)
	const note = page.locator('[data-shape-id="foreign"]')
	await note.click({ position: { x: 10, y: 10 } })
	const before = await note.boundingBox()
	expect(before).not.toBeNull()
	if (!before) throw new Error('Protected note is not visible')
	await page.mouse.move(before.x + 10, before.y + 10)
	await page.mouse.down()
	await page.mouse.move(before.x + 110, before.y + 80, { steps: 5 })
	expect(await note.boundingBox()).toEqual(before)
	await page.mouse.up()
	await page.keyboard.press('Delete')
	await expect(page.getByRole('status')).toHaveText(hint)
	await expect(page.getByRole('button', { name: 'Delete selected' })).toBeDisabled()
	await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeDisabled()
	await expect(page.getByRole('button', { name: 'Set color Green' })).toBeDisabled()
	await note.dblclick({ position: { x: 10, y: 10 } })
	await expect(page.getByRole('textbox', { name: '', exact: true })).toHaveCount(0)
	expect(writes).toBe(0)
	await expect(note).toHaveCount(1)
	expect((await board(request)).shapes.map((shape) => shape.id)).toEqual(['foreign'])
})

test('demo presenter profile sends authenticated canvas grants and revocations', async ({
	page,
	browser,
	request,
}) => {
	await resetBoard(request, [])
	const guest = await browser.newPage()
	try {
		for (const target of [page, guest]) {
			await target.route('**/api/runtime', async (route) => {
				const response = await route.fetch()
				await route.fulfill({
					json: { ...(await response.json()), auth: { mode: 'demo' }, aiEnabled: false },
				})
			})
		}
		const state = await (await request.get('/api/state')).json()
		let version = state.stateVersion
		const changes: { participantId: string; allowed: boolean }[] = []
		await page.route('**/api/canvases/*/permissions', async (route) => {
			expect(route.request().method()).toBe('PUT')
			expect(route.request().headers()['x-mico-whiteboard']).toBeTruthy()
			const body = route.request().postDataJSON()
			expect(body.participantId).toMatch(/^[a-f0-9]{64}$/)
			changes.push(body)
			await route.fulfill({
				json: {
					...state,
					stateVersion: ++version,
					canvasEditorIds: body.allowed ? [body.participantId] : [],
				},
			})
		})
		await page.goto('/?sharer=true')
		await guest.goto(`${ISOLATED_ORIGIN}/?username=Bob`)
		await page.getByRole('button', { name: 'Workspace profile' }).click()
		await page.getByRole('button', { name: 'Grant edit access to Bob', exact: true }).click()
		await expect(page.getByRole('img', { name: 'Bob, canvas editor', exact: true })).toBeVisible()
		await expect(
			page.locator('.meeting-avatar[data-editor="true"] .meeting-editor-badge'),
		).toBeVisible()
		await expect(page.locator('.meeting-avatar[data-presenter="true"]')).toHaveCount(1)
		await page.getByRole('button', { name: 'Revoke edit access from Bob', exact: true }).click()
		await expect(
			page.getByRole('button', { name: 'Grant edit access to Bob', exact: true }),
		).toBeVisible()
		await expect(page.getByRole('img', { name: 'Bob, participant', exact: true })).toBeVisible()
		await expect(page.locator('.meeting-editor-badge')).toHaveCount(0)
		expect(changes.map((change) => change.allowed)).toEqual([true, false])
		expect(changes[0].participantId).toBe(changes[1].participantId)
	} finally {
		await guest.close()
	}
})

test('demo draw survives delayed initial state without duplicate whiteboard joins', async ({
	page,
	request,
}) => {
	await resetBoard(request, [
		{ id: 'existing', type: 'rectangle', x: 180, y: 180, w: 120, h: 80, color: '#00a2e1' },
	])
	let releaseState!: () => void
	const stateGate = new Promise<void>((resolve) => {
		releaseState = resolve
	})
	let stateHeld = false
	let joins = 0
	const joinedTokens: string[] = []
	await page.route('**/api/runtime', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				auth: { mode: 'demo' },
				aiEnabled: false,
				aiSettingsVisible: false,
				mossEnabled: false,
				ephemeral: false,
			}),
		}),
	)
	await page.route('**/api/whiteboards/join', async (route) => {
		joins += 1
		const response = await route.fetch()
		const session = await response.json()
		joinedTokens.push(session.token)
		return route.fulfill({ response, json: session })
	})
	await page.route('**/api/state', async (route) => {
		if (!stateHeld) {
			stateHeld = true
			await stateGate
		}
		await route.continue()
	})
	const tokenedSockets: string[] = []
	await page.routeWebSocket(/\/api\/events/, async (socket) => {
		const token = new URL(socket.url()).searchParams.get('whiteboardSession')
		if (token) tokenedSockets.push(token)
		await stateGate
		const server = socket.connectToServer()
		socket.onMessage((message) => server.send(message))
		server.onMessage((message) => socket.send(message))
		socket.onClose((code, reason) => server.close({ code, reason }))
		server.onClose((code, reason) => socket.close({ code, reason }))
	})

	await page.goto('/')
	await expect.poll(() => stateHeld).toBe(true)
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await page.mouse.move(400, 300)
	await page.mouse.down()
	await page.mouse.move(540, 420, { steps: 4 })

	releaseState()
	await expect(page.locator('[data-shape-id="existing"]')).toBeVisible()
	await page.mouse.up()

	await expect
		.poll(
			async () =>
				(await board(request)).shapes.filter((shape) => shape.type === 'rectangle').length,
		)
		.toBe(2)
	await expect.poll(() => tokenedSockets.length).toBeGreaterThan(0)
	expect(joins).toBeLessThanOrEqual(2)
	expect(tokenedSockets.at(-1)).toBe(joinedTokens.at(-1))
})

test('demo mode gates AI to presenter and supports presenter request and transfer', async ({
	browser,
	request,
}, testInfo) => {
	test.setTimeout(45000)
	await resetBoard(request, [])
	const snapshot = await (await request.get('/api/state')).json()
	const context = await browser.newContext()
	try {
		const members = new Map<
			string,
			{
				token: string
				id: string
				username: string
				sharer: boolean
				color: string
				cursor: null
			}
		>()
		const sockets = new Map<string, import('@playwright/test').WebSocketRoute>()
		const requesterIds = new Set<string>()
		const broadcastPresence = () => {
			const list = [...members.values()].map(({ token: _t, ...member }) => member)
			const presenter = list.find((member) => member.sharer)
			const payload = JSON.stringify({
				type: 'presence',
				members: list,
				presenterId: presenter?.id ?? null,
				viewport: null,
				requesterIds: [...requesterIds],
			})
			for (const ws of sockets.values()) ws.send(payload)
		}

		await context.route('**/api/runtime', (route) =>
			route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({
					auth: { mode: 'demo' },
					aiEnabled: true,
					aiSettingsVisible: false,
					mossEnabled: false,
					ephemeral: false,
				}),
			}),
		)
		const aiTokensSeen: string[] = []
		await context.route('**/api/operations', async (route) => {
			const headers = { ...route.request().headers() }
			delete headers['x-mico-whiteboard']
			await route.continue({ headers })
		})
		await context.route('**/api/ai/chat', async (route) => {
			const headers = { ...route.request().headers() }
			const token = headers['x-mico-whiteboard']
			if (token) aiTokensSeen.push(token)
			delete headers['x-mico-whiteboard']
			await route.continue({ headers })
		})
		await context.route('**/api/whiteboards/join', async (route) => {
			const body = route.request().postDataJSON() as {
				clientId: string
				username: string
				sharer: boolean
			}
			const token = `token-${body.clientId}`
			const id = `member-${body.clientId}`
			const color = body.sharer ? '#6844bd' : '#006f91'
			members.set(token, {
				token,
				id,
				username: body.username,
				sharer: body.sharer,
				color,
				cursor: null,
			})
			broadcastPresence()
			return route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({
					token,
					whiteboardid: 'demo',
					member: { id, username: body.username, sharer: body.sharer, color, cursor: null },
				}),
			})
		})
		await context.routeWebSocket(/\/api\/events/, async (socket) => {
			const token = new URL(socket.url()).searchParams.get('whiteboardSession')
			if (!token) return
			sockets.set(token, socket)
			socket.send(JSON.stringify({ type: 'snapshot', ...snapshot }))
			broadcastPresence()
			socket.onMessage((raw) => {
				if (typeof raw !== 'string') return
				const message = JSON.parse(raw) as
					| { type: 'request-presenter'; requested: boolean }
					| { type: 'transfer-presenter'; targetMemberId: string }
					| { type: 'decline-presenter'; targetMemberId: string }
				const sender = members.get(token)
				if (!sender) return
				if (message.type === 'request-presenter') {
					if (message.requested) requesterIds.add(sender.id)
					else requesterIds.delete(sender.id)
					broadcastPresence()
				} else if (message.type === 'decline-presenter' && sender.sharer) {
					requesterIds.delete(message.targetMemberId)
					broadcastPresence()
				} else if (message.type === 'transfer-presenter' && sender.sharer) {
					const target = [...members.values()].find((m) => m.id === message.targetMemberId)
					if (!target) return
					sender.sharer = false
					target.sharer = true
					requesterIds.delete(sender.id)
					requesterIds.delete(target.id)
					broadcastPresence()
				}
			})
			socket.onClose(() => {
				if (sockets.get(token) === socket) sockets.delete(token)
			})
		})

		const presenter = await context.newPage()
		await presenter.goto('/?username=Host&sharer=true')
		await expect(presenter.getByRole('button', { name: /AI assistant/i })).toBeVisible()

		const viewer = await context.newPage()
		await viewer.goto('/?username=Ada&sharer=false')
		await expect(viewer.getByRole('button', { name: 'Rectangle', exact: true })).toBeVisible()
		await expect(viewer.getByRole('button', { name: /AI assistant/i })).toHaveCount(0)

		await presenter.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
		await presenter.screenshot({
			path: testInfo.outputPath('meeting-bar.png'),
			clip: { x: 0, y: 0, width: 850, height: 110 },
			animations: 'disabled',
		})
		for (const participantPage of [presenter, viewer]) {
			await expect(participantPage.locator('.meeting-avatar')).toHaveCount(2)
			await expect(
				participantPage.locator('.meeting-avatar[data-presenter="true"]'),
			).toHaveAttribute('aria-label', /Host, .*presenter/)
			await expect(
				participantPage.locator('.meeting-avatar[data-presenter="true"] .meeting-presenter-badge'),
			).toBeVisible()
		}
		await presenter.emulateMedia({ colorScheme: 'dark' })
		const darkTheme = await presenter.addStyleTag({
			content: '.radix-themes { color-scheme: dark; }',
		})
		await presenter.setViewportSize({ width: 1100, height: 800 })
		await expect(presenter.locator('.meeting-frame')).toHaveCSS('color-scheme', 'dark')
		await expect(presenter.locator('.meeting-presenter-badge')).toBeVisible()
		await presenter.screenshot({
			path: testInfo.outputPath('meeting-bar-dark.png'),
			clip: { x: 0, y: 0, width: 600, height: 110 },
			animations: 'disabled',
		})
		await darkTheme.evaluate((element) => element.parentNode?.removeChild(element))
		await presenter.emulateMedia({ colorScheme: 'light' })
		await presenter.setViewportSize({ width: 1440, height: 960 })

		// Non-presenter in demo mode can still draw manually on canvas
		await viewer.getByRole('button', { name: 'Sticky note', exact: true }).click()
		await viewer.mouse.click(420, 320)
		await expect
			.poll(async () => (await board(request)).shapes.some((shape) => shape.type === 'note'))
			.toBe(true)

		// Request presenter from viewer's Workspace profile -> Approve from presenter's Workspace profile
		await viewer.getByRole('button', { name: 'Workspace profile' }).click()
		const viewerPanel = viewer.getByRole('dialog', { name: 'Workspace profile' })
		await expect(viewerPanel.getByText('AI (Presenter only)', { exact: true })).toBeVisible()
		await viewerPanel.getByRole('button', { name: 'Request presenter', exact: true }).click()
		await expect(
			viewerPanel.getByRole('button', { name: 'Cancel request', exact: true }),
		).toBeVisible()
		await viewer.getByRole('button', { name: 'Close profile' }).click()
		await expect(viewerPanel).toHaveCount(0)

		await presenter.getByRole('button', { name: 'Workspace profile' }).click()
		const presenterPanel = presenter.getByRole('dialog', { name: 'Workspace profile' })
		await expect(presenterPanel.getByText('Requested', { exact: true })).toBeVisible()
		await presenterPanel.getByRole('button', { name: 'Approve', exact: true }).click()

		await expect(viewer.getByRole('button', { name: /AI assistant/i })).toBeVisible()
		await expect(presenter.getByRole('button', { name: /AI assistant/i })).toHaveCount(0)
		for (const participantPage of [presenter, viewer]) {
			await expect(
				participantPage.locator('.meeting-avatar[data-presenter="true"]'),
			).toHaveAttribute('aria-label', /Ada, .*presenter/)
		}

		// Newly promoted presenter can immediately open and use AI, with Demo session token attached
		const chat = await openAssistant(viewer, 'Chat')
		const composer = chat.getByRole('textbox', { name: 'Message the assistant' })
		await composer.fill('Draw projectile motion')
		await composer.press('Enter')
		await expect(chat.getByText('The diagram is ready', { exact: false })).toBeVisible({
			timeout: 15000,
		})
		expect(aiTokensSeen.length).toBeGreaterThan(0)

		// Direct transfer back without a request
		await viewer.getByRole('button', { name: 'Workspace profile' }).click()
		await expect(viewerPanel).toBeVisible()
		await viewerPanel.getByRole('button', { name: 'Transfer', exact: true }).click()
		await expect(presenter.getByRole('button', { name: /AI assistant/i })).toBeVisible()
		await expect(viewer.getByRole('button', { name: /AI assistant/i })).toHaveCount(0)
		await expect(viewer.locator('.meeting-avatar[data-presenter="true"]')).toHaveAttribute(
			'aria-label',
			'Host, presenter',
		)
	} finally {
		await context.close()
	}
})

test('local mode switcher toggles Local/Presenter/Guest in-place and opens Guest windows without URL params', async ({
	page,
	context,
}) => {
	await page.goto('/')
	const localModeButton = page.getByRole('button', { name: 'Local mode', exact: true })
	await expect(localModeButton).toBeVisible()
	await expect(localModeButton).toContainText('Local')
	await expect(page.getByRole('button', { name: /AI assistant/i })).toBeVisible()

	await localModeButton.click()
	const modePanel = page.getByRole('dialog', { name: 'Local mode' })
	await expect(modePanel).toBeVisible()

	// Switch to Presenter in-place
	await modePanel.getByRole('button', { name: 'Presenter', exact: true }).click()
	await expect(localModeButton).toContainText('Presenter')
	await expect(page.getByRole('button', { name: /AI assistant/i })).toBeVisible()

	// Open a Guest window in one click
	const popupPromise = context.waitForEvent('page')
	await modePanel.getByRole('button', { name: 'Open Guest window', exact: true }).click()
	const guest = await popupPromise
	await guest.waitForLoadState('domcontentloaded')

	await expect(guest.getByRole('button', { name: 'Local mode', exact: true })).toContainText(
		'Guest',
	)
	await expect(guest.getByRole('button', { name: /AI assistant/i })).toHaveCount(0)

	// Guest requests presenter via Local mode menu -> Presenter approves via DemoPanel
	await guest.getByRole('button', { name: 'Local mode', exact: true }).click()
	const guestModePanel = guest.getByRole('dialog', { name: 'Local mode' })
	await guestModePanel.getByRole('button', { name: 'Request presenter', exact: true }).click()
	await expect(
		guestModePanel.getByRole('button', { name: 'Cancel presenter request', exact: true }),
	).toBeVisible()

	await page.getByRole('button', { name: 'Workspace profile', exact: true }).click()
	const hostProfile = page.getByRole('dialog', { name: 'Workspace profile' })
	await expect(hostProfile.getByRole('switch', { name: 'Presenter', exact: true })).toBeVisible()
	await expect(hostProfile.getByText('Requested', { exact: true })).toBeVisible()
	await hostProfile.getByRole('button', { name: 'Approve', exact: true }).click()

	await expect(guest.getByRole('button', { name: /AI assistant/i })).toBeVisible()
	await expect(guest.getByRole('button', { name: 'Local mode', exact: true })).toContainText(
		'Presenter',
	)
	await expect(page.getByRole('button', { name: /AI assistant/i })).toHaveCount(0)
	await expect(localModeButton).toContainText('Guest')

	// Return main window to Local mode
	await guest.close()
	await localModeButton.click()
	await modePanel.getByRole('button', { name: 'Local', exact: true }).click()
	await expect(localModeButton).toContainText('Local')
	await expect(page.getByRole('button', { name: /AI assistant/i })).toBeVisible()
})
