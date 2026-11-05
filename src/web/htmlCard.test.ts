import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HTML_CARD_SANDBOX, htmlCardDocument } from './htmlCard.ts'

const bootstrapCss = '.bootstrap-probe { color: blue }'
const bootstrapJs = 'window.bootstrapProbe = true'

test('HTML cards embed Bootstrap, scripts and a restrictive CSP', () => {
	assert.equal(HTML_CARD_SANDBOX, 'allow-scripts')

	const withHead = htmlCardDocument(
		'<!doctype html><html><head><title>x</title><style>.user { color: red }</style></head><body></body></html>',
		bootstrapCss,
		bootstrapJs,
	)
	assert.match(withHead, /<head><meta http-equiv="Content-Security-Policy"/)
	assert.match(withHead, /default-src 'none'/)
	assert.match(withHead, /script-src 'unsafe-inline'/)
	assert.match(withHead, /style-src 'unsafe-inline'/)
	assert.match(withHead, /img-src data:/)
	assert.match(withHead, /font-src data:/)
	assert.match(withHead, /<style>\.bootstrap-probe/)
	assert.match(withHead, /<script>window\.bootstrapProbe = true<\/script>/)
	assert.ok(withHead.indexOf('.bootstrap-probe') < withHead.indexOf('.user'))

	const withoutHead = htmlCardDocument(
		'<html><body><h1>Hi</h1></body></html>',
		bootstrapCss,
		bootstrapJs,
	)
	assert.match(withoutHead, /<html><head><meta http-equiv="Content-Security-Policy"/)
	assert.match(withoutHead, /<\/head><body>/)

	const headOnly = htmlCardDocument(
		'<!doctype html><head><title>x</title></head><body><p>Hi</p></body>',
		bootstrapCss,
		bootstrapJs,
	)
	assert.match(headOnly, /^<!doctype html><html><head>/)
	assert.match(headOnly, /<\/head><body><p>Hi<\/p><\/body><\/html>$/)

	const fragment = htmlCardDocument(
		'<p>fragment</p><script>ran = true</script>',
		bootstrapCss,
		bootstrapJs,
	)
	assert.match(fragment, /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/)
	assert.match(fragment, /<body><p>fragment<\/p><script>ran = true<\/script><\/body><\/html>$/)
})
