import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectBrowserLocale, en, getMessages, zh } from './index.ts'

function collectKeys(obj: unknown, prefix = ''): string[] {
	if (!obj || typeof obj !== 'object') return [prefix]
	const out: string[] = []
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key
		if (value && typeof value === 'object') {
			out.push(...collectKeys(value, path))
		} else {
			out.push(path)
		}
	}
	return out.sort()
}

test('en and zh dictionaries share identical key paths', () => {
	assert.deepEqual(collectKeys(zh), collectKeys(en))
})

test('detectBrowserLocale resolves zh and en from navigator.languages', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
	try {
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: { languages: ['zh-CN', 'en-US'], language: 'zh-CN' },
		})
		assert.equal(detectBrowserLocale(), 'zh')
		assert.equal(getMessages(detectBrowserLocale()).identity.canvases, '画布列表')

		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: { languages: ['en-US'], language: 'en-US' },
		})
		assert.equal(detectBrowserLocale(), 'en')
		assert.equal(getMessages(detectBrowserLocale()).identity.canvases, 'Canvases')
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
		else delete (globalThis as { navigator?: Navigator }).navigator
	}
})
