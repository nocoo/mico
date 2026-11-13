import {
	type AuthenticationResult,
	type Configuration,
	PublicClientApplication,
} from '@azure/msal-browser'
import type { RuntimeAuthConfig } from './runtime'

const MSAL_SCOPES = ['openid', 'profile', 'email']

let instance: { key: string; ready: Promise<PublicClientApplication> } | null = null
let callbackCompletion: Promise<AuthenticationResult> | null = null

export function msalConfiguration(auth: RuntimeAuthConfig): Configuration {
	if (!auth.clientId) throw new Error('Microsoft sign-in is not configured.')
	const origin = window.location.origin
	return {
		auth: {
			clientId: auth.clientId,
			authority:
				auth.authority ??
				(auth.tenantId
					? `https://login.microsoftonline.com/${auth.tenantId}`
					: 'https://login.microsoftonline.com/common'),
			redirectUri: auth.redirectUri ?? `${origin}/auth/callback`,
		},
		cache: { cacheLocation: 'sessionStorage' },
	}
}

export function getMsal(auth: RuntimeAuthConfig): Promise<PublicClientApplication> {
	const key = JSON.stringify(msalConfiguration(auth))
	if (instance?.key === key) return instance.ready
	const application = new PublicClientApplication(msalConfiguration(auth))
	const ready = application
		.initialize()
		.then(() => application)
		.catch((error: unknown) => {
			if (instance?.ready === ready) instance = null
			throw error
		})
	instance = { key, ready }
	return ready
}

export async function loginWithMsal(auth: RuntimeAuthConfig): Promise<void> {
	const msal = await getMsal(auth)
	await msal.handleRedirectPromise({ navigateToLoginRequestUrl: false })
	await msal.loginRedirect({
		scopes: MSAL_SCOPES,
		redirectStartPage: `${window.location.origin}/`,
	})
}

export async function completeMsalRedirect(auth: RuntimeAuthConfig): Promise<AuthenticationResult> {
	const msal = await getMsal(auth)
	let result = await msal.handleRedirectPromise({ navigateToLoginRequestUrl: false })
	if (!result) {
		const hasResponse = [window.location.hash, window.location.search].some((value) => {
			const params = new URLSearchParams(value.slice(1))
			return params.has('code') || params.has('error')
		})
		if (hasResponse) {
			const params = new URLSearchParams(
				[window.location.hash, window.location.search]
					.find((value) => value.length > 1)
					?.slice(1) ?? '',
			)
			const description = params.get('error_description')?.replaceAll('+', ' ').trim()
			throw new Error(description || 'Microsoft sign-in was cancelled or failed.')
		}
		const accounts = msal.getAllAccounts()
		const account = msal.getActiveAccount() ?? (accounts.length === 1 ? accounts[0] : null)
		if (!account) throw new Error('Microsoft sign-in could not be resumed. Try signing in again.')
		result = await msal.acquireTokenSilent({ account, scopes: MSAL_SCOPES })
	}
	if (!result.idToken)
		throw new Error('Microsoft did not return an ID token. Try signing in again.')
	return result
}

export function completeCallback(auth: RuntimeAuthConfig): Promise<AuthenticationResult> {
	callbackCompletion ??= completeMsalRedirect(auth)
	return callbackCompletion
}

export async function clearMsalCache(auth: RuntimeAuthConfig): Promise<void> {
	callbackCompletion = null
	const msal = await getMsal(auth)
	await msal.clearCache()
}
