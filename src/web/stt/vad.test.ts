import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SilenceSegmenter } from './vad.ts'

const RATE = 16000
const FRAME = 320

function silence(ms: number): Int16Array {
	return new Int16Array((ms / 20) * FRAME)
}

function tone(ms: number, amplitude = 0.3): Int16Array {
	const out = new Int16Array((ms / 20) * FRAME)
	for (let index = 0; index < out.length; index++) {
		out[index] = Math.sin((2 * Math.PI * 220 * index) / RATE) * amplitude * 32767
	}
	return out
}

function concat(...chunks: Int16Array[]): Int16Array {
	const out = new Int16Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
	let offset = 0
	for (const chunk of chunks) {
		out.set(chunk, offset)
		offset += chunk.length
	}
	return out
}

test('speech followed by 500 ms of silence commits once', () => {
	const segmenter = new SilenceSegmenter()
	const committed = segmenter.push(concat(silence(600), tone(600), silence(700)))
	assert.equal(committed, true)
	assert.equal(segmenter.speaking, false)
	assert.ok(segmenter.lastTrailingMsValue >= 500)
	assert.equal(segmenter.currentSilenceMs, 500)
})

test('the Live default hard cap still commits continuous speech at 15 seconds', () => {
	const segmenter = new SilenceSegmenter()
	assert.equal(segmenter.push(tone(15_000)), true)
	assert.equal(segmenter.speaking, false)
})

test('Audio commits continuous speech at 15 seconds without committing silence', () => {
	const segmenter = new SilenceSegmenter()
	segmenter.setSilenceMs(1000)
	assert.equal(segmenter.push(silence(30_000)), false)
	assert.equal(segmenter.push(tone(14_980)), false)
	assert.equal(segmenter.push(tone(20)), true)
	assert.equal(segmenter.speaking, false)
	assert.equal(segmenter.push(silence(30_000)), false)
})

test('the silence threshold is configurable', () => {
	const segmenter = new SilenceSegmenter()
	segmenter.setSilenceMs(250)
	assert.equal(segmenter.push(concat(silence(600), tone(600), silence(350))), true)
	assert.equal(segmenter.currentSilenceMs, 250)
})

test('a sub-frame voiced tail remains detectable when the VAD is flushed', () => {
	const segmenter = new SilenceSegmenter({ maxSegmentMs: null })
	segmenter.setSilenceMs(1000)
	assert.equal(segmenter.push(tone(10)), false)
	assert.equal(segmenter.flush(), false)
	assert.equal(segmenter.hasSpeech, true)
})

test('1000 ms is a valid default Audio pause threshold', () => {
	const segmenter = new SilenceSegmenter({ maxSegmentMs: null })
	segmenter.setSilenceMs(1000)
	assert.equal(segmenter.push(concat(silence(600), tone(600), silence(999))), false)
	assert.equal(segmenter.push(silence(20)), true)
	assert.equal(segmenter.currentSilenceMs, 1000)
})
