import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseBenchArgs } from './audio-latency-bench.ts'
import { parseRealAudioArgs } from './verify-real-audio.ts'

test('audio-latency-bench requires explicit provider usage confirmation and validates flags', () => {
	assert.throws(() => parseBenchArgs([]), /--confirm-provider-usage/)

	assert.deepEqual(parseBenchArgs(['--confirm-provider-usage']), {
		confirmProviderUsage: true,
		caseId: 'c15-architecture-tradeoffs',
		model: undefined,
		summaryModel: undefined,
		lectureReasoning: undefined,
		summaryReasoning: undefined,
		hotMin: undefined,
		chunkSize: undefined,
		coalesceFillers: true,
		outPath: undefined,
	})

	assert.deepEqual(
		parseBenchArgs([
			'--confirm-provider-usage',
			'--case',
			'c14-quarterly-product-review',
			'--model',
			'auto/gpt-6-sol',
			'--summary-model',
			'auto/gpt-6-sol',
			'--lecture-reasoning',
			'none',
			'--summary-reasoning',
			'low',
			'--hot-min',
			'8',
			'--chunk-size',
			'12',
			'--coalesce-fillers',
			'false',
			'--out',
			'/tmp/bench.json',
		]),
		{
			confirmProviderUsage: true,
			caseId: 'c14-quarterly-product-review',
			model: 'auto/gpt-6-sol',
			summaryModel: 'auto/gpt-6-sol',
			lectureReasoning: 'none',
			summaryReasoning: 'low',
			hotMin: 8,
			chunkSize: 12,
			coalesceFillers: false,
			outPath: '/tmp/bench.json',
		},
	)

	assert.throws(() => parseBenchArgs(['--confirm-provider-usage', '--hot-min', '0']), /positive/)
	assert.throws(
		() => parseBenchArgs(['--confirm-provider-usage', '--coalesce-fillers', 'yes']),
		/true or false/,
	)
	assert.throws(() => parseBenchArgs(['--confirm-provider-usage', '--case']), /requires a value/)
	assert.throws(() => parseBenchArgs(['--confirm-provider-usage', '--bogus']), /Unknown argument/)
})

test('verify-real-audio requires explicit provider usage confirmation and validates flags', () => {
	assert.throws(() => parseRealAudioArgs([]), /--confirm-provider-usage/)

	assert.deepEqual(parseRealAudioArgs(['--confirm-provider-usage']), {
		confirmProviderUsage: true,
		clipId: 'c13-microsoft-outlook',
		model: undefined,
		summaryModel: undefined,
		lectureReasoning: undefined,
		summaryReasoning: undefined,
		hotMin: undefined,
		chunkSize: undefined,
		maxCatchUpMs: 30_000,
		screenshotPath: undefined,
		reportPath: undefined,
	})

	assert.deepEqual(
		parseRealAudioArgs([
			'--confirm-provider-usage',
			'--clip',
			'c06-science-fair',
			'--model',
			'auto/gpt-6-sol',
			'--lecture-reasoning',
			'none',
			'--summary-reasoning',
			'none',
			'--hot-min',
			'8',
			'--chunk-size',
			'12',
			'--max-catch-up-ms',
			'25000',
			'--screenshot',
			'/tmp/shot.png',
			'--out',
			'/tmp/report.json',
		]),
		{
			confirmProviderUsage: true,
			clipId: 'c06-science-fair',
			model: 'auto/gpt-6-sol',
			summaryModel: undefined,
			lectureReasoning: 'none',
			summaryReasoning: 'none',
			hotMin: 8,
			chunkSize: 12,
			maxCatchUpMs: 25_000,
			screenshotPath: '/tmp/shot.png',
			reportPath: '/tmp/report.json',
		},
	)

	assert.throws(
		() => parseRealAudioArgs(['--confirm-provider-usage', '--max-catch-up-ms', '-1']),
		/positive/,
	)
	assert.throws(
		() => parseRealAudioArgs(['--confirm-provider-usage', '--clip']),
		/requires a value/,
	)
	assert.throws(
		() => parseRealAudioArgs(['--confirm-provider-usage', '--unknown']),
		/Unknown argument/,
	)
})
