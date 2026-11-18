import { expect, test } from '@playwright/test'
import { board, closeAssistant, ISOLATED_ORIGIN, openAssistant, resetBoard } from './support'

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

test('presence tokens ride only canvas-management requests', async ({ page, request }) => {
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

	const stateTokens: string[] = []
	page.on('request', (sent) => {
		const url = new URL(sent.url())
		if (sent.method() === 'GET' && url.pathname === '/api/state')
			stateTokens.push(sent.headers()['x-mico-whiteboard'] ?? '')
	})
	await expect.poll(() => stateTokens.length, { timeout: 8000 }).toBeGreaterThan(0)

	let renameToken = ''
	await page.route(/\/api\/canvases\/[^/]+$/, async (route) => {
		if (route.request().method() !== 'PATCH') {
			await route.continue()
			return
		}
		renameToken = route.request().headers()['x-mico-whiteboard'] ?? ''
		await route.continue()
	})
	await page.getByRole('button', { name: 'Canvases', exact: true }).click()
	const panel = page.getByRole('region', { name: 'Canvases' })
	const mainItem = panel.locator('.canvas-item').filter({ hasText: 'My canvas' })
	await mainItem.hover()
	await panel.getByRole('button', { name: 'Rename My canvas', exact: true }).click()
	await panel.getByLabel('Canvas name').fill('Token check')
	await panel.getByLabel('Canvas name').press('Enter')
	await expect.poll(() => renameToken).not.toBe('')
	expect(renameToken.length).toBeGreaterThan(0)
	expect(stateTokens.every((token) => token === '')).toBe(true)
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
	await page.route('**/api/whiteboards/join', (route) => {
		joins += 1
		return route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				token: `demo-presence-token-${joins}`,
				whiteboardid: 'demo',
				member: {
					id: 'demo-member',
					username: 'Guest',
					sharer: false,
					color: '#6844bd',
					cursor: null,
				},
			}),
		})
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
		const token = new URL(socket.url()).searchParams.get('whiteboardsession')
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
	expect(tokenedSockets.at(-1)).toBe(`demo-presence-token-${joins}`)
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
		let presenterInvite: { targetMemberId: string; fromMemberId: string } | null = null
		const broadcastPresence = () => {
			const list = [...members.values()].map(({ token: _t, ...member }) => member)
			const presenter = list.find((member) => member.sharer)
			const payload = JSON.stringify({
				type: 'presence',
				members: list,
				presenterId: presenter?.id ?? null,
				viewport: null,
				requesterIds: [...requesterIds],
				presenterInvite,
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
			const token = new URL(socket.url()).searchParams.get('whiteboardsession')
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
					| { type: 'invite-presenter'; targetMemberId: string }
					| { type: 'respond-presenter-invite'; accept: boolean }
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
					presenterInvite = null
					requesterIds.delete(sender.id)
					requesterIds.delete(target.id)
					broadcastPresence()
				} else if (message.type === 'invite-presenter' && sender.sharer) {
					const target = [...members.values()].find((m) => m.id === message.targetMemberId)
					if (!target) return
					presenterInvite = { targetMemberId: target.id, fromMemberId: sender.id }
					broadcastPresence()
				} else if (message.type === 'respond-presenter-invite') {
					if (!presenterInvite || presenterInvite.targetMemberId !== sender.id) return
					const inviter = [...members.values()].find((m) => m.id === presenterInvite?.fromMemberId)
					presenterInvite = null
					if (message.accept && inviter) {
						inviter.sharer = false
						sender.sharer = true
					}
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
		await expect(presenter.locator('.live-topbar-frame')).toHaveCSS('color-scheme', 'dark')
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

		// Transfer sends an invite; recipient must confirm via the 20s invite dialog
		await viewer.getByRole('button', { name: 'Workspace profile' }).click()
		await expect(viewerPanel).toBeVisible()
		await viewerPanel.getByRole('button', { name: 'Transfer', exact: true }).click()
		await expect(viewerPanel.getByText('Invited', { exact: true })).toBeVisible()

		const inviteDialog = presenter.getByRole('dialog', { name: 'Presenter invite' })
		await expect(inviteDialog).toBeVisible()
		await expect(inviteDialog).toContainText('Ada invited you to present')
		await inviteDialog.getByRole('button', { name: 'Accept', exact: true }).click()

		await expect(inviteDialog).toHaveCount(0)
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

test('presenter receives a 20s floating request dialog that queues multiple guests and resets on new requests', async ({
	browser,
}) => {
	const context = await browser.newContext()
	try {
		const presenter = await context.newPage()
		const guestA = await context.newPage()
		const guestB = await context.newPage()

		await presenter.goto('/?localMode=presenter')
		await guestA.goto('/?localMode=guest')
		await guestB.goto('/?localMode=guest')

		await expect(presenter.getByRole('button', { name: /AI assistant/i })).toBeVisible()

		// Guest A requests presenter
		await guestA.getByRole('button', { name: 'Workspace profile', exact: true }).click()
		await guestA.getByRole('button', { name: 'Request presenter', exact: true }).click()

		const requestDialog = presenter.getByRole('dialog', { name: 'Presenter requests' })
		await expect(requestDialog).toBeVisible()
		await expect(requestDialog).toContainText('Presenter request')
		await expect(requestDialog.locator('.presenter-request-item')).toHaveCount(1)

		// Wait ~2.2s so the timer ticks down below 19s
		await presenter.waitForTimeout(2200)
		const timerTextBeforeB = await requestDialog.locator('.presenter-request-timer').textContent()
		expect(Number.parseInt(timerTextBeforeB ?? '20', 10)).toBeLessThanOrEqual(18)

		// Guest B also requests presenter -> both appear in list and timer resets to 20s
		await guestB.getByRole('button', { name: 'Workspace profile', exact: true }).click()
		await guestB.getByRole('button', { name: 'Request presenter', exact: true }).click()

		await expect(requestDialog).toContainText('2 presenter requests')
		await expect(requestDialog.locator('.presenter-request-item')).toHaveCount(2)
		const timerTextAfterB = await requestDialog.locator('.presenter-request-timer').textContent()
		expect(Number.parseInt(timerTextAfterB ?? '0', 10)).toBeGreaterThanOrEqual(19)

		// Presenter dismisses dialog -> dialog hides while requests stay in profile panel
		await requestDialog
			.getByRole('button', { name: 'Ignore presenter requests', exact: true })
			.click()
		await expect(requestDialog).toHaveCount(0)

		// Guest B cancels & re-requests -> dialog pops back up at 20s, Presenter approves Guest B directly
		await guestB.getByRole('button', { name: 'Cancel request', exact: true }).click()
		await guestB.getByRole('button', { name: 'Request presenter', exact: true }).click()
		await expect(requestDialog).toBeVisible()
		await requestDialog
			.locator('.presenter-request-item')
			.nth(1)
			.getByRole('button', { name: 'Approve', exact: true })
			.click()

		await expect(requestDialog).toHaveCount(0)
		await expect(guestB.getByRole('button', { name: /AI assistant/i })).toBeVisible()
		await expect(presenter.getByRole('button', { name: /AI assistant/i })).toHaveCount(0)
	} finally {
		await context.close()
	}
})

test('guest sticky note selection renders remote selection highlight in presenter view', async ({
	page,
	context,
	request,
}) => {
	const created = await request.post('/api/operations', {
		data: {
			operations: [
				{
					type: 'create',
					shape: {
						id: 'collab-note',
						type: 'note',
						x: 120,
						y: 120,
						w: 180,
						h: 120,
						color: '#ffe599',
						text: 'Shared Note',
					},
				},
			],
		},
	})
	expect(created.ok()).toBe(true)

	await page.goto('/')
	const localModeButton = page.getByRole('button', { name: 'Local mode', exact: true })
	await localModeButton.click()
	const modePanel = page.getByRole('dialog', { name: 'Local mode' })
	await modePanel.getByRole('button', { name: 'Presenter', exact: true }).click()

	const popupPromise = context.waitForEvent('page')
	await modePanel.getByRole('button', { name: 'Open Guest window', exact: true }).click()
	const guest = await popupPromise
	await guest.waitForLoadState('domcontentloaded')
	await expect(guest.getByRole('button', { name: 'Local mode', exact: true })).toContainText(
		'Guest',
	)

	await guest.locator('[data-shape-id="collab-note"]').click()
	const guestProps = guest.getByRole('region', { name: 'Selected object properties' })
	await expect(guestProps).toBeVisible()
	const guestPropsBox = await guestProps.boundingBox()
	const guestViewport = guest.viewportSize()
	expect(guestPropsBox).not.toBeNull()
	expect(guestViewport).not.toBeNull()
	if (guestPropsBox && guestViewport) {
		expect(guestViewport.width - (guestPropsBox.x + guestPropsBox.width)).toBeCloseTo(14, 1)
	}
	const remoteSelection = page.locator('.whiteboard-remote-selection[data-shape-id="collab-note"]')
	await expect(remoteSelection).toBeVisible()
	const borderColor = await remoteSelection.evaluate((el) =>
		getComputedStyle(el).getPropertyValue('--member-color').trim(),
	)
	expect(borderColor).not.toBe('')

	await guest.close()
})

const MEETING_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
)

test('a unicode meeting id scopes drawing through the query parameter', async ({
	page,
	request,
}) => {
	const meeting = '物理课-第3节'
	const scoped = (path: string) => `${path}?meetingid=${encodeURIComponent(meeting)}`
	const operationUrls: string[] = []
	page.on('request', (sent) => {
		if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/api/operations')
			operationUrls.push(sent.url())
	})

	await page.goto(`/?meetingid=${encodeURIComponent(meeting)}&username=Editor`)
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
	await page.mouse.move(420, 380)
	await page.mouse.down()
	await page.mouse.move(660, 500, { steps: 5 })
	await page.mouse.up()

	await expect.poll(() => page.locator('.canvas-shape').count()).toBeGreaterThanOrEqual(1)
	const shapeId = await page.locator('.canvas-shape').first().getAttribute('data-shape-id')
	expect(shapeId).toBeTruthy()
	await expect(page.locator(`[data-shape-id="${shapeId}"]`)).toHaveCount(1)
	expect(operationUrls.length).toBeGreaterThan(0)
	for (const url of operationUrls) {
		expect(new URL(url).searchParams.get('meetingid')).toBe(meeting)
	}
	await expect
		.poll(async () => {
			const meetingBoard = (await (await request.get(scoped('/api/board'))).json()) as {
				shapes: { id?: string; type: string }[]
			}
			return meetingBoard.shapes.some((shape) => shape.id === shapeId && shape.type === 'rectangle')
		})
		.toBe(true)
})

test('meeting-scoped uploads render scoped image assets', async ({ page, request }) => {
	const meeting = '美术课-第3节'
	const scoped = (path: string) => `${path}?meetingid=${encodeURIComponent(meeting)}`
	await page.goto(`/?meetingid=${encodeURIComponent(meeting)}&username=Editor`)
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await closeAssistant(page)

	const assetResponse = page.waitForResponse(
		(response) => {
			const url = new URL(response.url())
			return (
				/^\/api\/images\/[^/]+$/.test(url.pathname) && url.searchParams.get('meetingid') === meeting
			)
		},
		{ timeout: 10000 },
	)
	await page.getByLabel('Choose image').setInputFiles({
		name: 'meeting.png',
		mimeType: 'image/png',
		buffer: MEETING_PNG,
	})
	expect((await assetResponse).status()).toBe(200)
	await expect(page.locator('.canvas-image')).toHaveCount(1)

	const boardResponse = await request.get(scoped('/api/board'))
	expect(boardResponse.ok()).toBe(true)
	const meetingBoard = (await boardResponse.json()) as { shapes: { type: string }[] }
	expect(meetingBoard.shapes.some((shape) => shape.type === 'image')).toBe(true)
})
