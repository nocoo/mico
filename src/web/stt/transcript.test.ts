import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	dedupeHypothesis,
	formatClock,
	isWaitReply,
	type LessonClip,
	lectureSegmentText,
} from './transcript.ts'

const clip: LessonClip = {
	id: 'zh-physics-incline',
	lang: 'zh',
	subject: '物理',
	title: '斜面受力分析',
	voice: 'voice',
	script: 'scripts.txt',
	rate: '+20%',
	audio: 'audio/zh-physics-incline.mp3',
	duration: 202.6,
}

test('provisional text overlapping finalised text is trimmed', () => {
	assert.equal(dedupeHypothesis('连接体受到重力', '重力与支持力'), '与支持力')
	assert.equal(dedupeHypothesis('abc', 'xyz'), 'xyz')
	assert.equal(dedupeHypothesis('', 'xyz'), 'xyz')
})

test('lecture segments carry clip and timing metadata for the model', () => {
	const text = lectureSegmentText(clip, 3, 12.4, 24.8, '物体沿斜面下滑')
	assert.match(text, /^\[Lecture \| 物理 · 斜面受力分析 \| segment 3 \| 0:12–0:24\]/)
	assert.match(text, /物体沿斜面下滑$/)
})

test('WAIT is recognised as an explicit pause reply', () => {
	assert.equal(isWaitReply('WAIT'), true)
	assert.equal(isWaitReply(' wait. '), true)
	assert.equal(isWaitReply('I will wait'), false)
})

test('clock formatting is stable', () => {
	assert.equal(formatClock(0), '0:00')
	assert.equal(formatClock(65.9), '1:05')
	assert.equal(formatClock(-2), '0:00')
})
