import {
	getBearerTokenProvider,
	ManagedIdentityCredential,
	type TokenCredential,
} from '@azure/identity'

export const AZURE_AI_BEARER_SCOPE = 'https://ai.azure.com/.default'

export interface ManagedIdentityAuth {
	credential: TokenCredential
	chatBearer: () => Promise<string>
	maiBearer: () => Promise<string>
}

export function createManagedIdentityAuth(
	clientId: string,
	credential?: TokenCredential,
): ManagedIdentityAuth {
	const resolved = credential ?? new ManagedIdentityCredential({ clientId })
	const bearer = getBearerTokenProvider(resolved, AZURE_AI_BEARER_SCOPE)
	return {
		credential: resolved,
		chatBearer: bearer,
		maiBearer: bearer,
	}
}

export function createRedirectSafeFetch(): typeof globalThis.fetch {
	return async (input, init) => {
		const response = await globalThis.fetch(input, { ...init, redirect: 'manual' })
		if (response.status >= 300 && response.status <= 399) {
			await response.body?.cancel()
			throw new Error('AI provider redirected the authentication request')
		}
		return response
	}
}

export function createBearerFetch(getBearer: () => Promise<string>): typeof globalThis.fetch {
	return async (input, init) => {
		const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
		signal?.throwIfAborted()
		const token = await getBearer()
		signal?.throwIfAborted()
		const headers = new Headers(input instanceof Request ? input.headers : undefined)
		if (init?.headers) {
			const supplied = new Headers(init.headers)
			for (const [name, value] of supplied) headers.set(name, value)
		}
		headers.delete('api-key')
		headers.set('Authorization', `Bearer ${token}`)
		const response = await globalThis.fetch(input, { ...init, headers, redirect: 'manual' })
		if (response.status >= 300 && response.status <= 399) {
			await response.body?.cancel()
			throw new Error('AI provider redirected the authentication request')
		}
		return response
	}
}
