import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandLucideIcons, SUMMARY_ICON_NAMES } from './summaryIcons.ts'

test('summary icons are embedded as real Lucide SVG without scripts or remote resources', () => {
	for (const name of SUMMARY_ICON_NAMES) {
		const html = expandLucideIcons(`<i data-lucide="${name}"></i>`)
		assert.match(html, /<svg\b/)
		assert.match(html, /aria-hidden="true"/)
		assert.match(html, /<path|<circle|<line|<rect|<polyline/)
		assert.doesNotMatch(html, /<script|(?:href|src)=["']https?:\/\//)
	}
	assert.equal(expandLucideIcons('<i data-lucide="unknown"></i>'), '<i data-lucide="unknown"></i>')
})
