import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import manifest from '../../package.json' with { type: 'json' }
import { DEV_ORIGIN } from '../shared/config.ts'
import type { Board, Shape } from '../shared/types.ts'
import { createDaemon, type Daemon } from './index.ts'

interface ApiResult {
	status: number
	body: unknown
	headers: Headers
}

async function withDaemon(run: (url: string, daemon: Daemon) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'mico-api-'))
	let daemon: Daemon | undefined
	try {
		daemon = createDaemon({
			port: 0,
			dbPath: join(directory, 'board.sqlite'),
			settingsPath: join(directory, 'ai-settings', 'settings.json'),
		})
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		await run(`http://127.0.0.1:${address.port}`, daemon)
	} finally {
		if (daemon) {
			for (const client of daemon.wss.clients) client.terminate()
			daemon.close()
		}
		rmSync(directory, { recursive: true, force: true })
	}
}

async function api(
	url: string,
	path: string,
	init: RequestInit & { origin?: string | null } = {},
): Promise<ApiResult> {
	const { origin = DEV_ORIGIN, ...rest } = init
	const headers = new Headers(rest.headers)
	if (origin) headers.set('Origin', origin)
	if (rest.body !== undefined) headers.set('Content-Type', 'application/json')
	const response = await fetch(`${url}${path}`, { ...rest, headers })
	const text = await response.text()
	return {
		status: response.status,
		body: text.length > 0 ? JSON.parse(text) : null,
		headers: response.headers,
	}
}

async function apply(
	url: string,
	operations: unknown[],
	expectedRevision?: number,
	canvasId?: string,
) {
	return api(url, '/api/operations', {
		method: 'POST',
		body: JSON.stringify({
			operations,
			...(expectedRevision === undefined ? {} : { expectedRevision }),
			...(canvasId === undefined ? {} : { canvasId }),
		}),
	})
}

function shapeOf(board: Board, id: string): Shape {
	const shape = board.shapes.find((candidate) => candidate.id === id)
	assert.ok(shape, `missing shape ${id}`)
	return shape
}

function canvasOf(board: Board, id: string): Shape & { type: Exclude<Shape['type'], 'connector'> } {
	const shape = shapeOf(board, id)
	assert.notEqual(shape.type, 'connector')
	return shape as Shape & { type: Exclude<Shape['type'], 'connector'> }
}

function assertError(result: ApiResult, status: number, code: string, label = ''): void {
	assert.equal(result.status, status, label)
	const body = result.body as { error?: unknown; message?: unknown }
	assert.equal(body.error, code, label)
	assert.equal(typeof body.message, 'string', label)
	assert.ok((body.message as string).length > 0, label)
}

const rectangle = {
	id: 'rect',
	type: 'rectangle',
	x: 100,
	y: 100,
	w: 200,
	h: 80,
	color: '#5b5fc7',
	text: 'Gateway',
}
const ellipse = { id: 'ellipse', type: 'ellipse', x: 500, y: 100, w: 160, h: 120, color: '#22c55e' }
const text = {
	id: 'text',
	type: 'text',
	x: 100,
	y: 300,
	w: 320,
	h: 48,
	color: '#1d4ed8',
	text: 'Heading',
	font: 'hand',
	fontSize: 48,
	fontWeight: 700,
}
const line = { id: 'line', type: 'line', x: 520, y: 300, w: -180, h: 60, color: '#166534' }
const note = {
	id: 'note',
	type: 'note',
	x: 120,
	y: 420,
	w: 160,
	h: 160,
	color: '#fef3c7',
	text: 'Sticky',
	frameId: 'frame-a',
}
const path = {
	id: 'path',
	type: 'path',
	x: 320,
	y: 420,
	w: 120,
	h: 80,
	color: '#263248',
	brush: 'marker',
	strokeWidth: 4,
	points: [
		{ x: 0, y: 0 },
		{ x: 60, y: 80 },
		{ x: 120, y: 0 },
	],
}
const frameA = {
	id: 'frame-a',
	type: 'frame',
	x: 80,
	y: 380,
	w: 420,
	h: 260,
	color: '#3b82f6',
	title: 'Alpha',
}
const frameB = {
	id: 'frame-b',
	type: 'frame',
	x: 900,
	y: 100,
	w: 420,
	h: 260,
	color: '#22c55e',
	title: 'Beta',
}
const htmlCard = {
	id: 'html-card',
	type: 'html',
	x: 120,
	y: 420,
	w: 320,
	h: 180,
	color: '#22c55e',
	title: 'Revenue',
	html: '<p id="revenue">42</p>',
	frameId: 'frame-a',
}

test('health, board snapshots, revisions and method contracts', async () => {
	await withDaemon(async (url) => {
		const live = await api(url, '/api/live')
		assert.equal(live.status, 200)
		assert.deepEqual(live.body, { status: 'ok', version: manifest.version })

		const empty = await api(url, '/api/board')
		assert.equal(empty.status, 200)
		assert.deepEqual(empty.body, { revision: 0, shapes: [] })

		const created = await apply(url, [
			{ type: 'create', shape: rectangle },
			{ type: 'create', shape: ellipse },
		])
		assert.equal(created.status, 200)
		assert.equal((created.body as Board).revision, 1)
		assert.equal((created.body as Board).shapes.length, 2)

		const unchanged = await apply(url, [], 1)
		assert.equal(unchanged.status, 200)
		assert.equal((unchanged.body as Board).revision, 1)

		const updated = await apply(url, [{ type: 'update', id: 'rect', patch: { text: 'Edge' } }], 1)
		assert.equal(updated.status, 200)
		assert.equal((updated.body as Board).revision, 2)
		assert.equal(shapeOf(updated.body as Board, 'rect').type === 'rectangle', true)

		const stale = await apply(url, [{ type: 'update', id: 'rect', patch: { text: 'Nope' } }], 1)
		assertError(stale, 409, 'REVISION_CONFLICT')

		const conflicts = await apply(url, [
			{ type: 'update', id: 'rect', patch: { text: 'Concurrent' } },
			{ type: 'update', id: 'missing', patch: { text: 'Missing' } },
		])
		assertError(conflicts, 404, 'NOT_FOUND')
		const after = await api(url, '/api/board')
		assert.equal((after.body as Board).revision, 2)
		assert.equal(canvasOf(after.body as Board, 'rect').text, 'Edge')

		const badMethod = await api(url, '/api/board', { method: 'POST' })
		assert.equal(badMethod.status, 405)
		assert.equal(badMethod.headers.get('allow'), 'GET, OPTIONS')
		const badOperationsMethod = await api(url, '/api/operations')
		assert.equal(badOperationsMethod.status, 405)
		assert.equal(badOperationsMethod.headers.get('allow'), 'POST, OPTIONS')
		const unknown = await api(url, '/api/unknown')
		assert.equal(unknown.status, 404)
	})
})

test('every shape type round-trips through one batch', async () => {
	await withDaemon(async (url) => {
		const response = await apply(url, [
			{ type: 'create', shape: frameA },
			{ type: 'create', shape: frameB },
			{ type: 'create', shape: note },
			{ type: 'create', shape: htmlCard },
			{ type: 'create', shape: path },
			{ type: 'create', shape: text },
			{ type: 'create', shape: line },
			{ type: 'create', shape: rectangle },
			{ type: 'create', shape: ellipse },
			{
				type: 'create',
				shape: {
					id: 'frame-edge',
					type: 'connector',
					from: 'frame-a',
					to: 'frame-b',
					color: '#5c6474',
				},
			},
			{
				type: 'create',
				shape: { id: 'edge', type: 'connector', from: 'rect', to: 'ellipse', color: '#5c6474' },
			},
		])
		assert.equal(response.status, 200)
		const board = response.body as Board
		assert.equal(board.shapes.length, 11)
		assert.deepEqual([...new Set(board.shapes.map((shape) => shape.type))].sort(), [
			'connector',
			'ellipse',
			'frame',
			'html',
			'line',
			'note',
			'path',
			'rectangle',
			'text',
		])
		assert.deepEqual(
			board.shapes.find((shape) => shape.id === 'html-card'),
			htmlCard,
		)
		assert.equal(canvasOf(board, 'note').frameId, 'frame-a')

		for (const expected of [frameA, frameB, note, htmlCard, path, text, line, rectangle, ellipse]) {
			assert.deepEqual(shapeOf(board, expected.id), expected, `round-trip ${expected.id}`)
		}
		assert.deepEqual(shapeOf(board, 'frame-edge'), {
			id: 'frame-edge',
			type: 'connector',
			from: 'frame-a',
			to: 'frame-b',
			color: '#5c6474',
		})
		assert.deepEqual(shapeOf(board, 'edge'), {
			id: 'edge',
			type: 'connector',
			from: 'rect',
			to: 'ellipse',
			color: '#5c6474',
		})

		const fetched = await api(url, '/api/board')
		assert.deepEqual(fetched.body, board)
	})
})

test('canvas lifecycle, active switching and per-canvas operations', async () => {
	await withDaemon(async (url) => {
		const state = await api(url, '/api/state')
		assert.equal(state.status, 200)
		const initial = state.body as {
			stateVersion: number
			activeCanvasId: string
			canvases: Array<{ id: string; name: string; preview?: string }>
			board: Board
		}
		assert.equal(typeof initial.stateVersion, 'number')
		const initialVersion = initial.stateVersion
		assert.equal(initial.activeCanvasId, 'main')
		assert.equal(initial.canvases.length, 1)
		assert.equal(initial.canvases[0].name, 'My canvas')
		assert.match(initial.canvases[0].preview ?? '', /^data:image\/svg\+xml;base64,/)
		assert.deepEqual(initial.board, { revision: 0, shapes: [] })

		const created = await api(url, '/api/canvases', {
			method: 'POST',
			body: JSON.stringify({ name: 'Second canvas', activate: true }),
		})
		assert.equal(created.status, 200)
		const second = created.body as {
			stateVersion: number
			activeCanvasId: string
			canvases: Array<{ id: string; name: string }>
			board: Board
			createdCanvasId: string
		}
		assert.ok(second.stateVersion > initialVersion)
		assert.equal(second.activeCanvasId, second.createdCanvasId)
		assert.equal(second.canvases.length, 2)
		assert.deepEqual(second.board, { revision: 0, shapes: [] })

		const list = await api(url, '/api/canvases')
		assert.equal(list.status, 200)
		assert.equal((list.body as { canvases: unknown[] }).canvases.length, 2)
		assert.equal(typeof (list.body as { stateVersion: number }).stateVersion, 'number')
		const lightState = await api(url, '/api/state?previews=0')
		assert.equal(lightState.status, 200)
		assert.equal(
			(lightState.body as { canvases: Array<{ preview?: string }> }).canvases.every(
				(canvas) => canvas.preview === undefined,
			),
			true,
		)

		const detail = await api(url, `/api/canvases/${second.createdCanvasId}`)
		assert.equal(detail.status, 200)
		assert.equal((detail.body as { canvas: { name: string } }).canvas.name, 'Second canvas')

		const renamed = await api(url, `/api/canvases/${second.createdCanvasId}`, {
			method: 'PATCH',
			body: JSON.stringify({ name: 'Renamed canvas' }),
		})
		assert.equal(renamed.status, 200)
		assert.ok(
			(renamed.body as { canvases: Array<{ id: string; name: string }> }).canvases.some(
				(canvas) => canvas.id === second.createdCanvasId && canvas.name === 'Renamed canvas',
			),
		)

		const written = await apply(
			url,
			[
				{
					type: 'create',
					shape: {
						id: 'targeted-shape',
						type: 'note',
						x: 10,
						y: 10,
						w: 80,
						h: 80,
						color: '#fff8d4',
						text: 'Targeted',
					},
				},
			],
			undefined,
			second.createdCanvasId,
		)
		assert.equal(written.status, 200)
		assert.equal((written.body as Board).revision, 1)
		const afterTarget = (await api(url, '/api/state')).body as {
			activeCanvasId: string
			board: Board
		}
		assert.equal(afterTarget.activeCanvasId, second.createdCanvasId)
		assert.deepEqual(
			afterTarget.board.shapes.map((shape) => shape.id),
			['targeted-shape'],
		)

		const activated = await api(url, '/api/active-canvas', {
			method: 'PUT',
			body: JSON.stringify({ id: 'main' }),
		})
		assert.equal(activated.status, 200)
		assert.equal((activated.body as { activeCanvasId: string }).activeCanvasId, 'main')
		assert.deepEqual((activated.body as { board: Board }).board.shapes, [])

		const deleted = await api(url, `/api/canvases/${second.createdCanvasId}`, { method: 'DELETE' })
		assert.equal(deleted.status, 200)
		assert.equal((deleted.body as { canvases: unknown[] }).canvases.length, 1)

		for (const [method, path, body] of [
			['POST', '/api/canvases', JSON.stringify({ name: '', activate: true })],
			['POST', '/api/canvases', JSON.stringify({ activate: 'yes' })],
			['POST', '/api/canvases', JSON.stringify({ name: 'x', extra: true })],
			['PATCH', `/api/canvases/${second.createdCanvasId}`, JSON.stringify({ title: 'nope' })],
			['PUT', '/api/active-canvas', JSON.stringify({})],
		] as const) {
			const rejected = await api(url, path, { method, body })
			assert.equal(rejected.status, 400, `${method} ${path} ${body}`)
			assertError(rejected, 400, 'INVALID_REQUEST', `${method} ${path}`)
		}

		const missing = await api(url, '/api/canvases/missing')
		assert.equal(missing.status, 404)
		const last = await api(url, '/api/canvases/main', { method: 'DELETE' })
		assert.equal(last.status, 400)
		assert.equal((last.body as { error: string }).error, 'LAST_CANVAS')
	})
})

test('shape validation rejects malformed payloads atomically', async () => {
	await withDaemon(async (url) => {
		const base = await apply(url, [
			{ type: 'create', shape: frameA },
			{ type: 'create', shape: frameB },
			{ type: 'create', shape: htmlCard },
			{ type: 'create', shape: rectangle },
			{ type: 'create', shape: ellipse },
		])
		assert.equal(base.status, 200)
		const invalid: [string, Record<string, unknown>][] = [
			[
				'unknown shape type',
				{ id: 'x', type: 'widget', x: 0, y: 0, w: 10, h: 10, color: '#123456' },
			],
			['legacy widget keys', { ...rectangle, id: 'x', widget: 'todo' }],
			['negative rectangle', { ...rectangle, id: 'x', w: -1 }],
			['note font', { ...note, id: 'x', font: 'hand' }],
			['line font', { ...line, id: 'x', font: 'hand' }],
			['frame without title', { ...frameA, id: 'x', title: undefined }],
			['frame empty title', { ...frameA, id: 'x', title: '' }],
			['nested frame', { ...frameA, id: 'x', frameId: 'frame-a' }],
			['html without markup', { ...htmlCard, id: 'x', html: undefined }],
			['html non-string markup', { ...htmlCard, id: 'x', html: 12 }],
			['html oversized markup', { ...htmlCard, id: 'x', html: 'x'.repeat(200_001) }],
			['html unknown key', { ...htmlCard, id: 'x', text: 'nope' }],
			['path unknown brush', { ...path, id: 'x', brush: 'crayon' }],
			[
				'path point outside bounds',
				{
					...path,
					id: 'x',
					points: [
						{ x: 0, y: 0 },
						{ x: 500, y: 10 },
					],
				},
			],
			['path zero stroke', { ...path, id: 'x', strokeWidth: 0 }],
			['text unknown font', { ...text, id: 'x', font: 'comic' }],
			['text tiny font', { ...text, id: 'x', fontSize: 4 }],
			['text heavy weight', { ...text, id: 'x', fontWeight: 950 }],
			['missing frame reference', { ...note, id: 'x', frameId: 'missing-frame' }],
			['html cannot host members', { ...note, id: 'x', frameId: 'html-card' }],
			[
				'connector to itself',
				{ id: 'x', type: 'connector', from: 'rect', to: 'rect', color: '#123456' },
			],
			[
				'connector missing endpoint',
				{ id: 'x', type: 'connector', from: 'rect', to: 'missing', color: '#123456' },
			],
			[
				'frame to element connector',
				{ id: 'x', type: 'connector', from: 'frame-a', to: 'rect', color: '#123456' },
			],
			[
				'connector anchor out of range',
				{
					id: 'x',
					type: 'connector',
					from: 'rect',
					to: 'ellipse',
					fromAnchor: 12,
					color: '#123456',
				},
			],
		]
		for (const [label, shape] of invalid) {
			const response = await apply(url, [{ type: 'create', shape }])
			assertError(response, 400, 'INVALID_REQUEST', label)
		}
		const board = await api(url, '/api/board')
		assert.equal((board.body as Board).revision, 1)
		assert.equal((board.body as Board).shapes.length, 5)

		const malformed = await api(url, '/api/operations', {
			method: 'POST',
			body: '{"operations":',
		})
		assertError(malformed, 400, 'INVALID_JSON')
	})
})

test('patch validation is scoped to the target shape type', async () => {
	await withDaemon(async (url) => {
		const response = await apply(url, [
			{ type: 'create', shape: frameA },
			{ type: 'create', shape: htmlCard },
			{ type: 'create', shape: note },
			{ type: 'create', shape: path },
			{ type: 'create', shape: text },
			{ type: 'create', shape: rectangle },
			{ type: 'create', shape: ellipse },
			{ type: 'create', shape: line },
		])
		assert.equal(response.status, 200)

		const validPatches: [string, Record<string, unknown>, (board: Board) => void][] = [
			[
				'rect',
				{ text: 'Renamed', color: '#166534' },
				(board) => {
					assert.equal(canvasOf(board, 'rect').text, 'Renamed')
					assert.equal(canvasOf(board, 'rect').color, '#166534')
					assert.equal(canvasOf(board, 'rect').x, rectangle.x)
				},
			],
			[
				'note',
				{ text: 'Updated note', frameId: null },
				(board) => {
					assert.equal(canvasOf(board, 'note').text, 'Updated note')
					assert.equal(canvasOf(board, 'note').frameId, undefined)
				},
			],
			[
				'html-card',
				{ title: 'Revenue 2026', html: '<p>43</p>' },
				(board) => {
					assert.deepEqual(canvasOf(board, 'html-card'), {
						...htmlCard,
						title: 'Revenue 2026',
						html: '<p>43</p>',
					})
				},
			],
			[
				'frame-a',
				{ title: 'Renamed frame', color: '#f472b6' },
				(board) => {
					assert.equal(canvasOf(board, 'frame-a').title, 'Renamed frame')
					assert.equal(canvasOf(board, 'frame-a').color, '#f472b6')
					assert.equal(canvasOf(board, 'frame-a').w, frameA.w)
				},
			],
			[
				'path',
				{ brush: 'pencil', strokeWidth: 2 },
				(board) => {
					assert.equal(canvasOf(board, 'path').brush, 'pencil')
					assert.equal(canvasOf(board, 'path').strokeWidth, 2)
					assert.deepEqual(canvasOf(board, 'path').points, path.points)
				},
			],
			[
				'text',
				{ font: 'serif', fontSize: 24, fontWeight: 400 },
				(board) => {
					assert.equal(canvasOf(board, 'text').font, 'serif')
					assert.equal(canvasOf(board, 'text').fontSize, 24)
					assert.equal(canvasOf(board, 'text').fontWeight, 400)
				},
			],
			[
				'line',
				{ x: 10, y: 20, w: -40, h: -30 },
				(board) => {
					assert.equal(canvasOf(board, 'line').x, 10)
					assert.equal(canvasOf(board, 'line').y, 20)
					assert.equal(canvasOf(board, 'line').w, -40)
					assert.equal(canvasOf(board, 'line').h, -30)
				},
			],
		]
		for (const [id, patch, check] of validPatches) {
			const patched = await apply(url, [{ type: 'update', id, patch }])
			assert.equal(patched.status, 200, `${id} should accept ${JSON.stringify(patch)}`)
			check(patched.body as Board)
		}
		const detached = await api(url, '/api/board')
		assert.equal(canvasOf(detached.body as Board, 'note').frameId, undefined)
		assert.equal(canvasOf(detached.body as Board, 'line').w, -40)

		const invalidPatches: [string, Record<string, unknown>][] = [
			['rect', { title: 'nope' }],
			['rect', { html: '<p>nope</p>' }],
			[
				'rect',
				{
					points: [
						{ x: 0, y: 0 },
						{ x: 1, y: 1 },
					],
				},
			],
			['rect', { from: 'note' }],
			['note', { font: 'hand' }],
			['note', { frameId: 'html-card' }],
			['html-card', { text: 'nope' }],
			['html-card', { fontSize: 20 }],
			['frame-a', { text: 'nope' }],
			['frame-a', { frameId: 'frame-a' }],
			['path', { title: 'nope' }],
			['text', { brush: 'marker' }],
			['ellipse', { widget: 'todo' }],
			['rect', { frameId: 'missing-frame' }],
		]
		for (const [id, patch] of invalidPatches) {
			const rejected = await apply(url, [{ type: 'update', id, patch }])
			assertError(rejected, 400, 'INVALID_REQUEST', `${id} should reject ${JSON.stringify(patch)}`)
		}
		const ignoredLineText = await apply(url, [
			{ type: 'update', id: 'line', patch: { text: 'ignored but accepted' } },
		])
		assert.equal(ignoredLineText.status, 200)

		const missing = await apply(url, [{ type: 'update', id: 'missing', patch: { x: 0 } }])
		assert.equal(missing.status, 404)
	})
})

test('operation envelopes are validated and oversized bodies are rejected', async () => {
	await withDaemon(async (url) => {
		const malformed = [
			{},
			{ operations: 'create' },
			{ operations: [], expectedRevision: -1 },
			{ operations: [], expectedRevision: 1.5 },
			{ operations: [{ type: 'move', id: 'x' }] },
			{ operations: [{ type: 'create' }] },
			{ operations: [{ type: 'update', id: 'x' }] },
			{ operations: [{ type: 'delete' }] },
		]
		for (const body of malformed) {
			const response = await api(url, '/api/operations', {
				method: 'POST',
				body: JSON.stringify(body),
			})
			assertError(response, 400, 'INVALID_REQUEST', JSON.stringify(body))
		}

		const oversized = await api(url, '/api/operations', {
			method: 'POST',
			body: JSON.stringify({
				operations: [
					{
						type: 'create',
						shape: {
							id: 'too-large',
							type: 'html',
							x: 0,
							y: 0,
							w: 100,
							h: 100,
							color: '#123456',
							title: 'Large',
							html: 'x'.repeat(1_100_000),
						},
					},
				],
			}),
		})
		assertError(oversized, 413, 'PAYLOAD_TOO_LARGE')

		const after = await api(url, '/api/board')
		assert.deepEqual(after.body, { revision: 0, shapes: [] })
	})
})

test('frame membership, deletion and connector classes stay consistent', async () => {
	await withDaemon(async (url) => {
		const response = await apply(url, [
			{ type: 'create', shape: frameA },
			{ type: 'create', shape: frameB },
			{ type: 'create', shape: note },
			{ type: 'create', shape: htmlCard },
			{
				type: 'create',
				shape: {
					id: 'text-member',
					type: 'text',
					x: 140,
					y: 430,
					w: 200,
					h: 40,
					color: '#1d4ed8',
					text: 'Member',
					frameId: 'frame-a',
				},
			},
			{
				type: 'create',
				shape: {
					id: 'frame-edge',
					type: 'connector',
					from: 'frame-a',
					to: 'frame-b',
					fromAnchor: 3,
					toAnchor: 5,
					color: '#5c6474',
				},
			},
			{
				type: 'create',
				shape: {
					id: 'member-edge',
					type: 'connector',
					from: 'note',
					to: 'text-member',
					color: '#5c6474',
				},
			},
		])
		assert.equal(response.status, 200)

		const mixed = await apply(url, [{ type: 'update', id: 'frame-edge', patch: { to: 'note' } }])
		assert.equal(mixed.status, 400)
		const reverse = await apply(url, [
			{
				type: 'create',
				shape: { id: 'mixed', type: 'connector', from: 'note', to: 'frame-a', color: '#5c6474' },
			},
		])
		assert.equal(reverse.status, 400)

		const deleted = await apply(url, [
			{ type: 'delete', id: 'frame-a' },
			{ type: 'delete', id: 'note' },
		])
		assert.equal(deleted.status, 200)
		const board = deleted.body as Board
		assert.ok(!board.shapes.some((shape) => shape.id === 'frame-a'))
		assert.ok(!board.shapes.some((shape) => shape.id === 'note'))
		assert.ok(!board.shapes.some((shape) => shape.id === 'member-edge'))
		const remaining = board.shapes.find((shape) => shape.id === 'text-member')
		assert.equal(remaining?.type === 'text' ? remaining.frameId : 'x', undefined)
		assert.ok(!board.shapes.some((shape) => shape.id === 'frame-edge'))
		assert.ok(!board.shapes.some((shape) => shape.id === 'member-edge'))
	})
})

test('HTTP hardening covers origins, hosts, preflight and unknown endpoints', async () => {
	await withDaemon(async (url, daemon) => {
		const address = daemon.server.address()
		assert.ok(address && typeof address !== 'string')
		const port = address.port

		const evilOrigin = await api(url, '/api/board', { origin: 'https://evil.example' })
		assertError(evilOrigin, 403, 'FORBIDDEN_ORIGIN')

		const preflight = await api(url, '/api/operations', { method: 'OPTIONS' })
		assert.equal(preflight.status, 204)
		assert.equal(preflight.headers.get('access-control-allow-origin'), DEV_ORIGIN)
		assert.equal(
			preflight.headers.get('access-control-allow-methods'),
			'GET, POST, PUT, PATCH, DELETE, OPTIONS',
		)
		assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type')

		const unknownPreflight = await api(url, '/api/unknown', { method: 'OPTIONS' })
		assert.equal(unknownPreflight.status, 404)

		const badHost = await new Promise<number>((resolve, reject) => {
			const req = request(
				{
					host: '127.0.0.1',
					port,
					path: '/api/board',
					headers: { Host: 'evil.example' },
				},
				(response) => {
					response.resume()
					response.on('end', () => resolve(response.statusCode ?? 0))
				},
			)
			req.on('error', reject)
			req.end()
		})
		assert.equal(badHost, 403)
	})
})
