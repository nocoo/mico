import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRequestTarget } from './requestTarget.ts'

test('request targets share one decoded path for routing and authorization', () => {
	assert.equal(parseRequestTarget('/api/%73tate?previews=0').pathname, '/api/state')
	assert.equal(parseRequestTarget('/assets/a%20b.js').pathname, '/assets/a b.js')
	assert.equal(parseRequestTarget('/api/state?value=%2f').url.searchParams.get('value'), '/')
})

test('request targets reject alternate authorities, separators and traversal before routing', () => {
	for (const path of [
		undefined,
		'',
		'https://other.example/api/state',
		'//ignored//api/canvases',
		'/api//canvases',
		'/assets/..%2fevals/manifest.json',
		'/assets/..%5cevals/manifest.json',
		'/assets/%2e%2e/evals/manifest.json',
		'/assets/../evals/manifest.json',
		'/assets/%252e%252e%252fevals/manifest.json',
		'/assets/./app.js',
		'/api/state#fragment',
		'/api/state\\other',
		'/api/%00state',
		'/api/%invalid',
	]) {
		assert.throws(() => parseRequestTarget(path), String(path))
	}
})
