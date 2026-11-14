import {
	getBearerTokenProvider,
	ManagedIdentityCredential,
	type TokenCredential,
} from '@azure/identity'

export const CHAT_BEARER_SCOPE = 'https://ai.azure.com/.default'
export const MAI_BEARER_SCOPE = 'https://cognitiveservices.azure.com/.default'

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
	return {
		credential: resolved,
		chatBearer: getBearerTokenProvider(resolved, CHAT_BEARER_SCOPE),
		maiBearer: getBearerTokenProvider(resolved, MAI_BEARER_SCOPE),
	}
}

export function createRedirectSafeFetch(): typeof globalThis.fetch {
	return async (input, init) => {
		const response = await globalThis.fetch(input, { ...init, redirect: 'manual' })
		if (response.status >= 300 && response.status <= 399) {
			throw new Error('AI provider redirected the authentication request')
		}
		return response
	}
}

export function createBearerFetch(getBearer: () => Promise<string>): typeof globalThis.fetch {
	return async (input, init) => {
		const token = await getBearer()
		const headers = new Headers(input instanceof Request ? input.headers : undefined)
		if (init?.headers) {
			const supplied = new Headers(init.headers)
			for (const [name, value] of supplied) headers.set(name, value)
		}
		headers.set('Authorization', `Bearer ${token}`)
		const response = await globalThis.fetch(input, { ...init, headers, redirect: 'manual' })
		if (response.status >= 300 && response.status <= 399) {
			throw new Error('AI provider redirected the authentication request')
		}
		return response
	}
}
