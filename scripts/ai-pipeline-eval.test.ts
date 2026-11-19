import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import type { Board } from '../src/shared/types.ts'
import {
	type CaseRubric,
	evaluateBoardAgainstRubric,
	loadLayeredEvalSuite,
	parseEvalCliArgs,
	runLayeredEval,
} from './ai-pipeline-eval.ts'

test('layered eval suite fixtures exist with expected multi-topic structure', () => {
	const suite = loadLayeredEvalSuite()
	assert.equal(suite.layers.length, 5)
	assert.deepEqual(
		suite.layers.map((layer) => layer.id),
		['L1', 'L2', 'L3', 'L4', 'L5'],
	)
	const byId = new Map(suite.cases.map((entry) => [entry.id, entry]))
	assert.ok(byId.has('c12-service-incident'))
	assert.ok(byId.has('c13-microsoft-outlook'))
	const c14 = byId.get('c14-quarterly-product-review')
	const c15 = byId.get('c15-architecture-tradeoffs')
	assert.ok(c14 && c15)
	assert.equal(c14.expectedTopics.length, 5)
	assert.equal(c14.expectedExecutiveCard, true)
	assert.equal(c15.expectedTopics.length, 3)
	assert.equal(c15.expectedExecutiveCard, true)

	for (const entry of suite.cases) {
		assert.equal(existsSync(entry.file), true, `Missing fixture file: ${entry.file}`)
	}

	const c14Text = readFileSync(c14.file, 'utf8')
	const c14Lines = c14Text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
	assert.ok(c14Lines.length >= 110, `Expected >=110 lines in c14, got ${c14Lines.length}`)
	assert.match(c14Text, /总结到这里/)
	assert.match(c14Text, /回到刚才第二个议题/)
	assert.match(c14Text, /下周五/)

	const c15Text = readFileSync(c15.file, 'utf8')
	const c15Lines = c15Text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
	assert.ok(c15Lines.length >= 42, `Expected >=42 lines in c15, got ${c15Lines.length}`)
	assert.match(c15Text, /going back briefly to topic two/i)
	assert.match(c15Text, /8 connections/i)
})

test('CLI flags enforce --confirm-provider-usage for live eval mode', () => {
	assert.deepEqual(parseEvalCliArgs([]), {
		layer: 'all',
		json: false,
		live: false,
		confirmProviderUsage: false,
		caseId: undefined,
	})
	assert.deepEqual(parseEvalCliArgs(['--layer', 'L1', '--json']), {
		layer: 'L1',
		json: true,
		live: false,
		confirmProviderUsage: false,
		caseId: undefined,
	})
	assert.equal(parseEvalCliArgs(['--layer=L3', '--json']).json, true)
	assert.equal(parseEvalCliArgs(['--layer=L3', '--json']).layer, 'L3')
	assert.throws(() => parseEvalCliArgs(['--layer', 'L9']), /--layer/)

	const blocked = spawnSync(process.execPath, ['scripts/ai-pipeline-eval.ts', '--live'], {
		encoding: 'utf8',
		timeout: 5000,
	})
	assert.notEqual(blocked.status, 0)
	assert.match(blocked.stderr, /--confirm-provider-usage/)
})

test('board rubric evaluator scores single-topic, premature-singleton and multi-topic boards', () => {
	const suite = loadLayeredEvalSuite()
	const c12Rubric = suite.cases.find((item) => item.id === 'c12-service-incident') as CaseRubric
	const c14Rubric = suite.cases.find(
		(item) => item.id === 'c14-quarterly-product-review',
	) as CaseRubric

	const singleTopicBoard: Board = {
		revision: 12,
		shapes: [
			{
				id: 'title',
				type: 'text',
				x: 80,
				y: 144,
				w: 360,
				h: 64,
				color: '#2b3038',
				text: '线上结算故障复盘',
				fontSize: 48,
			},
			{
				id: 'lane-1',
				type: 'frame',
				x: 40,
				y: 220,
				w: 1440,
				h: 520,
				color: '#00a2e1',
				title: '结算故障机制与恢复',
			},
			{
				id: 'n1',
				type: 'note',
				x: 80,
				y: 260,
				w: 260,
				h: 180,
				color: '#e2f5fc',
				frameId: 'lane-1',
				text: '09:42 99.6% -> 82% 京 鲁 10:12 配置',
			},
			{
				id: 'b1',
				type: 'rectangle',
				x: 840,
				y: 260,
				w: 220,
				h: 96,
				color: '#00a2e1',
				frameId: 'lane-1',
				text: '配置变更放大重试',
			},
			{
				id: 'topic-card-incident',
				type: 'html',
				x: 1620,
				y: 260,
				w: 960,
				h: 640,
				color: '#00a2e1',
				title: '结算故障复盘总结',
				html: '<main>09:42 99.6% 82% 京 鲁 配置 10:12</main>',
			},
			{
				id: 'actions-main',
				type: 'actions',
				x: 2640,
				y: 260,
				w: 320,
				h: 240,
				color: '#f1fadc',
				title: '后续行动',
				items: [
					{ id: 'a1', text: '配置一致性校验', done: false },
					{ id: 'a2', text: '灰度恢复演练', done: false },
					{ id: 'a3', text: '联动告警上线', done: false },
				],
			},
		],
	}
	const singleReport = evaluateBoardAgainstRubric(singleTopicBoard, c12Rubric)
	assert.equal(singleReport.passed, true)
	assert.equal(singleReport.topicCards, 1)
	assert.equal(singleReport.executiveSummaryCards, 0)
	assert.equal(singleReport.topicCoverageRatio, 1)

	const prematureBoard: Board = {
		revision: 20,
		shapes: [
			{
				id: 'lane-1',
				type: 'frame',
				x: 40,
				y: 220,
				w: 1440,
				h: 520,
				color: '#00a2e1',
				title: 'Q3数据复盘',
			},
			{
				id: 'summary-only',
				type: 'html',
				x: 1620,
				y: 260,
				w: 1200,
				h: 2000,
				color: '#00a2e1',
				title: 'Q3数据总结',
				html: '<main>184万 11.6%</main>',
			},
		],
	}
	const prematureReport = evaluateBoardAgainstRubric(prematureBoard, c14Rubric)
	assert.equal(prematureReport.passed, false)
	assert.equal(prematureReport.topicCards, 1)
	assert.equal(prematureReport.topicCoverageRatio, 0.2)
	assert.equal(prematureReport.executiveCardMatch, false)

	const multiTopicBoard: Board = {
		revision: 80,
		shapes: [
			...Array.from({ length: 5 }, (_, index) => {
				const top = 240 + index * 860
				return [
					{
						id: `lane-${index + 1}`,
						type: 'frame' as const,
						x: 40,
						y: top,
						w: 1440,
						h: 640,
						color: '#00a2e1',
						title: c14Rubric.expectedTopics[index],
					},
					{
						id: `note-${index + 1}`,
						type: 'note' as const,
						x: 80,
						y: top + 40,
						w: 260,
						h: 180,
						color: '#e2f5fc',
						frameId: `lane-${index + 1}`,
						text: '184万 11.6% 方案B 下周五 小陈 1.1 40万 10月28日',
					},
					{
						id: `topic-card-${index + 1}`,
						type: 'html' as const,
						x: 1620,
						y: top + 40,
						w: 960,
						h: 640,
						color: '#00a2e1',
						title: `议题${index + 1}：${c14Rubric.expectedTopics[index]}`,
						html: `<main>${c14Rubric.expectedTopics[index]}</main>`,
					},
				]
			}).flat(),
			{
				id: 'executive-summary',
				type: 'html',
				x: 2720,
				y: 280,
				w: 1000,
				h: 760,
				color: '#00a2e1',
				title: '会议全局总览',
				html: '<main>Executive Overview</main>',
			},
			{
				id: 'actions-global',
				type: 'actions',
				x: 2720,
				y: 1120,
				w: 360,
				h: 320,
				color: '#f1fadc',
				title: '全会待办',
				items: [
					{ id: 't1', text: '[Q3复盘] 阿敏：首屏优化', done: false },
					{ id: 't2', text: '[结算] 老周/小陈：下周五灰度', done: false },
					{ id: 't3', text: '[客户端] 林涛：包体积裁剪', done: false },
					{ id: 't4', text: '[压测] 阿凯：10月25日前配限流', done: false },
				],
			},
		],
	}
	const multiReport = evaluateBoardAgainstRubric(multiTopicBoard, c14Rubric)
	assert.equal(multiReport.passed, true)
	assert.equal(multiReport.topicCards, 5)
	assert.equal(multiReport.executiveSummaryCards, 1)
	assert.equal(multiReport.topicCoverageRatio, 1)
	assert.equal(multiReport.overlapPairs, 0)
	assert.equal(multiReport.frameOverlapPairs, 0)
})

test('isolated layered eval produces all L1-L5 metrics cleanly', async () => {
	const suite = loadLayeredEvalSuite()
	const targets = new Map(suite.layers.map((layer) => [layer.id, layer.targets]))
	const l1 = targets.get('L1') as Record<string, number | boolean>
	const l2 = targets.get('L2') as Record<string, number | boolean>
	const l3 = targets.get('L3') as Record<string, number | boolean>
	const l4 = targets.get('L4') as Record<string, number | boolean>

	const report = await runLayeredEval({ layer: 'all' })
	assert.ok(report.L1 && report.L2 && report.L3 && report.L4 && report.L5)

	assert.equal(report.L1.parallelChainSucceeded, l1.parallelChainSucceeded)
	assert.equal(report.L1.geometryReceiptPresent, l1.geometryReceiptPresent)
	assert.equal(report.L1.htmlCardRuntimeCssInjected, l1.htmlCardRuntimeCssInjected)
	assert.ok(report.L1.activeLectureNoImageSchemaBytes <= Number(l1.lectureNoImageSchemaBytesMax))

	assert.equal(
		report.L2.systemPromptInvariantAcrossRevisions,
		l2.systemPromptInvariantAcrossRevisions,
	)
	assert.equal(report.L2.anchorsRetainedAt180Shapes, l2.anchorsRetainedAt180Shapes)
	assert.ok(report.L2.boardContext180ShapesBytes <= Number(l2.boardContext180ShapesBytesMax))

	assert.equal(report.L3.turn105AcceptedWithoutHttp400, l3.turn105AcceptedWithoutHttp400)
	assert.equal(report.L3.turn120AcceptedWithoutHttp400, l3.turn120AcceptedWithoutHttp400)
	assert.ok(
		(report.L3.turn120ModelBytes ?? Number.POSITIVE_INFINITY) <= Number(l3.turn120ModelBytesMax),
	)
	assert.ok(
		(report.L3.turn120CacheablePrefixRatio ?? 0) >= Number(l3.turn120CacheablePrefixRatioMin),
	)

	assert.ok(report.L4.liveMicDefaultSilenceMs >= Number(l4.liveMicDefaultSilenceMsMin))
	assert.equal(report.L4.audioPlaybackDefaultSilenceMs, Number(l4.audioPlaybackDefaultSilenceMs))
	assert.ok(report.L4.maxQueueDepth <= Number(l4.maxQueueDepthMax))
	assert.ok(report.L4.p95DrawingLagMs <= Number(l4.p95DrawingLagMsMax))
	assert.equal(report.L4.summaryRecoveredAfterLectureError, l4.summaryRecoveredAfterLectureError)

	assert.equal(report.L5.promptAllowsMultipleTopicCards, true)
	assert.equal(report.L5.promptDefinesTopicTransitionTrigger, true)
	assert.equal(report.L5.promptNoSingletonSummaryLock, true)
	assert.equal(report.L5.promptRequiresConditionalExecutiveCard, true)
})
