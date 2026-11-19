export function getQueryParam(searchOrUrl: string, name: string): string | null {
	const target = name.toLowerCase()
	const queryStart = searchOrUrl.indexOf('?')
	const rawSearch = queryStart >= 0 ? searchOrUrl.slice(queryStart + 1) : searchOrUrl
	const params = new URLSearchParams(rawSearch.replace(/^\?/, ''))
	for (const [key, value] of params.entries()) {
		if (key.toLowerCase() === target) return value
	}
	return null
}
