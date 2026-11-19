export const MEETING_QUERY_KEY = 'meetingid'
export const MAX_MEETING_ID_LENGTH = 256

export function meetingIdFromSearch(search: string): string | null {
	const queryStart = search.indexOf('?')
	const raw = queryStart >= 0 ? search.slice(queryStart + 1) : search
	for (const [key, value] of new URLSearchParams(raw).entries()) {
		if (key.toLowerCase() !== MEETING_QUERY_KEY) continue
		const trimmed = value.trim()
		return trimmed ? trimmed.slice(0, MAX_MEETING_ID_LENGTH) : null
	}
	return null
}

export function setMeetingScope(url: URL, meetingId: string | null | undefined): URL {
	if (meetingId) url.searchParams.set(MEETING_QUERY_KEY, meetingId)
	return url
}

export function withMeetingScope(path: string, meetingId: string | null | undefined): string {
	if (!meetingId) return path
	const queryStart = path.indexOf('?')
	const pathname = queryStart >= 0 ? path.slice(0, queryStart) : path
	const params = new URLSearchParams(queryStart >= 0 ? path.slice(queryStart + 1) : '')
	for (const key of [...params.keys()]) {
		if (key.toLowerCase() === MEETING_QUERY_KEY) params.delete(key)
	}
	params.set(MEETING_QUERY_KEY, meetingId)
	return `${pathname}?${params.toString()}`
}

export function meetingAssetUrl(imageId: string, meetingId: string | null | undefined): string {
	return withMeetingScope(`/api/images/${encodeURIComponent(imageId)}`, meetingId)
}
