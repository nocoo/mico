import assert from 'node:assert/strict'
import { test } from 'node:test'
import { htmlCardDocument } from './htmlCard.ts'

test('HTML cards receive a restrictive CSP in the head', () => {
	const withHead = htmlCardDocument(
		'<!doctype html><html><head><title>x</title></head><body></body></html>',
	)
	assert.match(withHead, /<head><meta http-equiv="Content-Security-Policy"/)
	assert.match(withHead, /default-src 'none'/)
	assert.match(withHead, /style-src 'unsafe-inline'/)

	const withoutHead = htmlCardDocument('<html><body><h1>Hi</h1></body></html>')
	assert.match(withoutHead, /<html><head><meta http-equiv="Content-Security-Policy"/)
	assert.match(withoutHead, /<\/head><body>/)

	const fragment = htmlCardDocument('<p>fragment</p>')
	assert.match(fragment, /^<meta http-equiv="Content-Security-Policy"/)
	assert.match(fragment, /<p>fragment<\/p>$/)
})
