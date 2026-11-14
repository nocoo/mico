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
		const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
		signal?.throwIfAborted()
		const response = await globalThis.fetch(input, { ...init, redirect: 'manual' })
		if (response.status >= 300 && response.status <= 399) {
			await response.body?.cancel()
			throw new Error('AI provider redirected the authentication request')
		}
		return response
	}
}
