import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWaveformBuckets } from './waveform.ts'

function assertClose(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) < 0.0001)
}

test('waveform buckets preserve recorded min and max values', () => {
	const buckets = buildWaveformBuckets(new Float32Array([-0.8, 0.6, -0.2, 0.9]), 2)
	assert.equal(buckets.length, 2)
	assertClose(buckets[0].min, -0.8)
	assertClose(buckets[0].max, 0.6)
	assertClose(buckets[1].min, -0.2)
	assertClose(buckets[1].max, 0.9)
})

test('waveform buckets aggregate real peaks instead of generating shape', () => {
	const peaks = new Float32Array([-0.5, 0.2, -0.8, 0.7, -0.1, 0.4, -0.3, 0.6])
	const buckets = buildWaveformBuckets(peaks, 2)
	assert.equal(buckets.length, 2)
	assertClose(buckets[0].min, -0.8)
	assertClose(buckets[0].max, 0.7)
	assertClose(buckets[1].min, -0.3)
	assertClose(buckets[1].max, 0.6)
})

test('empty or malformed waveform data has no buckets', () => {
	assert.deepEqual(buildWaveformBuckets(null, 20), [])
	assert.deepEqual(buildWaveformBuckets(new Float32Array([0.2]), 20), [])
	assert.deepEqual(buildWaveformBuckets(new Float32Array(), 20), [])
})
