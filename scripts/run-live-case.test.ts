import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { POST_SESSION_SUMMARY_PROMPT } from '../src/shared/summaryPrompt.ts'
import {
	buildTurnRequest,
	canvasName,
	compactTimestamp,
	createLiveCaseCanvas,
	type FetchLike,
	formatLectureSegmentText,
	parseCase,
	parseRound,
	splitZhSentences,
} from './run-live-case.ts'

test('round and case identities are exact', () => {
	assert.equal(parseRound('1'), 1)
	assert.equal(parseRound('4'), 4)
	assert.throws(() => parseRound(undefined), /Usage:/)
	assert.throws(() => parseRound('0'), /Usage:/)
	assert.throws(() => parseRound('3.5'), /Usage:/)
	assert.throws(() => parseCase(undefined), /handover.*incident/)
	assert.equal(parseCase('handover'), 'handover')
	assert.equal(parseCase('incident'), 'incident')
	assert.throws(() => parseCase('other'), /handover.*incident/)

	const date = new Date('2026-11-04T12:34:56.789Z')
	assert.equal(compactTimestamp(date), '20261104T123456789Z')
	assert.equal(canvasName(1, date), '急诊交接 · 第1轮 · 20261104T123456789Z')
	assert.equal(canvasName(4, date, 'incident'), '服务故障复盘 · 第4轮 · 20261104T123456789Z')
})

test('replay requires explicit live canvas confirmation before any API call', () => {
	const run = spawnSync(process.execPath, ['scripts/run-live-case.ts', '4', '--case', 'incident'], {
		encoding: 'utf8',
		timeout: 5000,
	})
	assert.equal(run.status, 1)
	assert.match(run.stderr, /--confirm-live-canvas/)
	const missingCase = spawnSync(
		process.execPath,
		['scripts/run-live-case.ts', '4', '--confirm-live-canvas'],
		{
			encoding: 'utf8',
			timeout: 5000,
			env: { ...process.env, MICO_API: 'http://127.0.0.1:1' },
		},
	)
	assert.equal(missingCase.status, 1)
	assert.match(missingCase.stderr, /--case/)
})

test('fixed incident fixture has 14 to 18 sentences in 4 to 5 paragraphs', () => {
	const text = readFileSync('evals/cases/c12-service-incident.zh.txt', 'utf8')
	const paragraphs = text
		.trim()
		.split(/\n+/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
	assert.ok(paragraphs.length >= 4 && paragraphs.length <= 5)
	const sentences = splitZhSentences(text)
	assert.ok(sentences.length >= 14 && sentences.length <= 18)
	assert.equal(sentences.length, 17)
	assert.match(text, /已查明的直接原因|属于未证实的怀疑项/)
	assert.match(text, /更正前一事实|复盘中需要再更正一个事实/)
	assert.match(text, /最终总结：/)
})

test('lecture format and turn requests are case-specific and canvas-pinned', () => {
	assert.equal(
		formatLectureSegmentText(1, '患者胸痛已缓解。'),
		'[Lecture | 急诊护理交接 · 急诊交接 | segment 1 | 0:00–0:00] 患者胸痛已缓解。',
	)
	assert.equal(
		formatLectureSegmentText(1, '监控数据已更新。', 'incident'),
		'[Lecture | 服务故障复盘 · 线上结算故障复盘 | segment 1 | 0:00–0:00] 监控数据已更新。',
	)
	assert.deepEqual(buildTurnRequest('监控数据已更新。', 'lecture', 'canvas-incident'), {
		text: '监控数据已更新。',
		body: { selection: [], mode: 'lecture', canvasId: 'canvas-incident' },
	})
	assert.deepEqual(buildTurnRequest(POST_SESSION_SUMMARY_PROMPT, 'chat', 'canvas-incident'), {
		text: POST_SESSION_SUMMARY_PROMPT,
		body: { selection: [], mode: 'chat', canvasId: 'canvas-incident' },
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

	const canvasId = await createLiveCaseCanvas(
		fetchImpl,
		'http://mock',
		'服务故障复盘 · 第4轮 · test',
	)
	assert.equal(canvasId, 'canvas-1')
	assert.equal(calls.length, 2)
	assert.equal(calls[0].url, 'http://mock/api/canvases')
	assert.equal(calls[0].init?.method, 'POST')
	assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
		name: '服务故障复盘 · 第4轮 · test',
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
		createLiveCaseCanvas(missingFetch, 'http://mock', '服务故障复盘 · 第4轮 · test'),
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
		})
	}
	await assert.rejects(
		createLiveCaseCanvas(mismatchFetch, 'http://mock', '服务故障复盘 · 第4轮 · test'),
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
		createLiveCaseCanvas(nonemptyFetch, 'http://mock', '服务故障复盘 · 第4轮 · test'),
		/not empty/,
	)
})
