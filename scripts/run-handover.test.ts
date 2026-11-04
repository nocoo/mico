import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { POST_SESSION_SUMMARY_PROMPT } from '../src/shared/summaryPrompt.ts'
import {
	buildTurnRequest,
	canvasName,
	compactTimestamp,
	createHandoverCanvas,
	type FetchLike,
	formatLectureSegmentText,
	parseRound,
	splitZhSentences,
} from './run-handover.ts'

test('handover round and canvas identity are exact', () => {
	assert.equal(parseRound('1'), 1)
	assert.equal(parseRound('2'), 2)
	assert.throws(() => parseRound(undefined), /Usage:/)
	assert.throws(() => parseRound('3'), /Usage:/)

	const date = new Date('2026-11-04T12:34:56.789Z')
	assert.equal(compactTimestamp(date), '20261104T123456789Z')
	const round1 = canvasName(1, date)
	const round2 = canvasName(2, date)
	assert.match(round1, /急诊交接/)
	assert.match(round1, /第1轮/)
	assert.match(round1, /20261104T123456789Z/)
	assert.match(round2, /急诊交接/)
	assert.match(round2, /第2轮/)
	assert.equal(round1.includes('第2轮'), false)
})

test('replay requires explicit live canvas confirmation before any API call', () => {
	const run = spawnSync(process.execPath, ['scripts/run-handover.ts', '1'], {
		encoding: 'utf8',
		timeout: 5000,
	})
	assert.equal(run.status, 1)
	assert.match(run.stderr, /--confirm-live-canvas/)
})

test('Chinese sentence segmentation and browser lecture format are deterministic', () => {
	assert.deepEqual(splitZhSentences('患者胸痛已缓解。护士交接两项风险！'), [
		'患者胸痛已缓解。',
		'护士交接两项风险！',
	])
	assert.deepEqual(splitZhSentences('  \r\n  '), [])
	assert.equal(
		formatLectureSegmentText(1, '患者胸痛已缓解。'),
		'[Lecture | 急诊护理交接 · 急诊交接 | segment 1 | 0:00–0:00] 患者胸痛已缓解。',
	)
})

test('turn request pins lecture or chat mode to the created canvas', () => {
	assert.deepEqual(buildTurnRequest('交接患者', 'lecture', 'canvas-1'), {
		text: '交接患者',
		body: { selection: [], mode: 'lecture', canvasId: 'canvas-1' },
	})
	assert.deepEqual(buildTurnRequest(POST_SESSION_SUMMARY_PROMPT, 'chat', 'canvas-1'), {
		text: POST_SESSION_SUMMARY_PROMPT,
		body: { selection: [], mode: 'chat', canvasId: 'canvas-1' },
	})
})

test('canvas creation posts only activate and verifies the returned id', async () => {
	const calls: { url: string; init?: RequestInit }[] = []
	const fetchImpl: FetchLike = async (input, init) => {
		const url = String(input)
		calls.push({ url, init })
		if (url.endsWith('/api/canvases') && init?.method === 'POST') {
			return new Response(JSON.stringify({ createdCanvasId: 'canvas-1' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		}
		if (url.endsWith('/api/canvases/canvas-1')) {
			return new Response(
				JSON.stringify({ canvas: { id: 'canvas-1' }, board: { revision: 0, shapes: [] } }),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			)
		}
		return new Response('{}', { status: 404 })
	}

	const canvasId = await createHandoverCanvas(fetchImpl, 'http://mock', '急诊交接 · 第1轮 · test')
	assert.equal(canvasId, 'canvas-1')
	assert.equal(calls.length, 2)
	assert.equal(calls[0].url, 'http://mock/api/canvases')
	assert.equal(calls[0].init?.method, 'POST')
	assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
		name: '急诊交接 · 第1轮 · test',
		activate: true,
	})
	assert.equal(calls[1].url, 'http://mock/api/canvases/canvas-1')
})

test('canvas creation rejects a missing or mismatched returned id', async () => {
	const missingFetch: FetchLike = async () =>
		new Response(JSON.stringify({}), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	await assert.rejects(
		createHandoverCanvas(missingFetch, 'http://mock', '急诊交接 · 第1轮 · test'),
		/verified id/,
	)

	const mismatchFetch: FetchLike = async (_input, init) => {
		if (init?.method === 'POST') {
			return new Response(JSON.stringify({ createdCanvasId: 'canvas-1' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		}
		return new Response(JSON.stringify({ canvas: { id: 'other' }, board: {} }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	}
	await assert.rejects(
		createHandoverCanvas(mismatchFetch, 'http://mock', '急诊交接 · 第1轮 · test'),
		/id verification failed/,
	)
	const nonemptyFetch: FetchLike = async (_input, init) =>
		new Response(
			JSON.stringify(
				init?.method === 'POST'
					? { createdCanvasId: 'canvas-1' }
					: { canvas: { id: 'canvas-1' }, board: { revision: 1, shapes: [{}] } },
			),
			{ status: 200 },
		)
	await assert.rejects(
		createHandoverCanvas(nonemptyFetch, 'http://mock', '急诊交接 · 第1轮 · test'),
		/not empty/,
	)
})
