export function parseRequestTarget(raw: string | undefined): { url: URL; pathname: string } {
	if (
		!raw?.startsWith('/') ||
		raw.startsWith('//') ||
		raw.includes('\\') ||
		raw.includes('#') ||
		[...raw].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
	) {
		throw new Error('Invalid request target')
	}
	const rawPath = raw.split('?', 1)[0]
	const url = new URL(raw, 'http://127.0.0.1')
	const pathname = decodeURIComponent(url.pathname)
	if (
		url.pathname !== rawPath ||
		/%2f|%5c/i.test(rawPath) ||
		pathname.includes('\\') ||
		pathname.includes('%') ||
		pathname.includes('//') ||
		[...pathname].some(
			(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		) ||
		pathname.split('/').some((segment) => segment === '.' || segment === '..')
	) {
		throw new Error('Non-canonical request target')
	}
	return { url, pathname }
}
