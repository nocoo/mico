import type { MsalLike } from './msal.ts'

const PHOTO_URL = 'https://graph.microsoft.com/v1.0/me/photos/96x96/$value'
const MAX_PHOTO_BYTES = 1024 * 1024

export async function fetchUserAvatar(msal: MsalLike, signal: AbortSignal): Promise<Blob | null> {
	try {
		if (signal.aborted) return null
		const accounts = msal.getAllAccounts()
		const account = msal.getActiveAccount() ?? (accounts.length === 1 ? accounts[0] : null)
		if (!account) return null
		const token = await msal.acquireTokenSilent({ account, scopes: ['User.Read'] })
		if (signal.aborted || !token.accessToken) return null
		const response = await fetch(PHOTO_URL, {
			headers: { Authorization: `Bearer ${token.accessToken}` },
			credentials: 'omit',
			redirect: 'error',
			cache: 'no-store',
			signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
		})
		const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
		const size = Number(response.headers.get('content-length'))
		if (
			!response.ok ||
			(contentType !== 'image/jpeg' && contentType !== 'image/png') ||
			size > MAX_PHOTO_BYTES
		) {
			await response.body?.cancel()
			return null
		}
		const reader = response.body?.getReader()
		if (!reader) return null
		const chunks: Uint8Array<ArrayBuffer>[] = []
		let received = 0
		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				received += value.byteLength
				if (received > MAX_PHOTO_BYTES) {
					await reader.cancel()
					return null
				}
				chunks.push(new Uint8Array(value))
			}
		} finally {
			reader.releaseLock()
		}
		return received > 0 && !signal.aborted ? new Blob(chunks, { type: contentType }) : null
	} catch {
		return null
	}
}
