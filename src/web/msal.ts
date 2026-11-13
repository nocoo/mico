import { type Configuration, PublicClientApplication } from '@azure/msal-browser'
import type { PublicRuntimeContract } from '../shared/runtime'
import { fetchSession, sessionExpired } from './runtime.ts'

const MSAL_SCOPES = ['openid', 'profile', 'email']

export interface MsalAccount {
	homeAccountId?: string
	[name: string]: unknown
}

export interface MsalRedirectResult {
	accessToken?: string
	idToken?: string
	account?: MsalAccount
}

export interface MsalLike {
	initialize?: () => Promise<void> | void
	handleRedirectPromise: (options: {
		navigateToLoginRequestUrl: boolean
	}) => Promise<MsalRedirectResult | null>
	loginRedirect: (request: { scopes: string[]; redirectStartPage?: string }) => Promise<void>
	clearCache: () => Promise<void>
	setActiveAccount?: (account: MsalAccount) => void
	getAllAccounts: () => MsalAccount[]
	getActiveAccount: () => MsalAccount | null
	acquireTokenSilent: (request: {
		account: MsalAccount
		scopes: string[]
	}) => Promise<MsalRedirectResult>
}

let instance: { key: string; ready: Promise<MsalLike> } | null = null
let callbackCompletion: { key: string; promise: Promise<ServerSession> } | null = null

interface ServerSession {
	user: { name: string; expiresAt: number } | null
}

function redirectAuthority(auth: PublicRuntimeContract['auth']): string {
	const tenantId = auth.tenantId?.trim()
	const configuredAuthority = auth.authority?.trim()
	let authority = configuredAuthority

	if (!authority) {
		if (!tenantId) throw new Error('Microsoft sign-in requires a configured tenant or authority.')
		authority = `https://login.microsoftonline.com/${tenantId}`
	}

	let url: URL
	try {
		url = new URL(authority)
	} catch {
		throw new Error('Microsoft sign-in authority is invalid.')
	}
	if (
		url.protocol !== 'https:' ||
		url.hostname !== 'login.microsoftonline.com' ||
		url.search ||
		url.hash ||
		url.username ||
		url.password
	) {
		throw new Error('Microsoft sign-in authority is invalid.')
	}
	const tenant = url.pathname.replace(/^\/+|\/+$/g, '')
	if (
		!tenant ||
		tenant.includes('/') ||
		['common', 'organizations', 'consumers'].includes(tenant)
	) {
		throw new Error('Microsoft sign-in must use a configured tenant, not /common.')
	}
	if (tenantId && tenant !== tenantId) {
		throw new Error('Microsoft sign-in tenant and authority do not match.')
	}
	return url.toString().replace(/\/$/, '')
}

export function msalConfiguration(
	auth: PublicRuntimeContract['auth'],
	origin = window.location.origin,
): Configuration {
	if (auth.mode !== 'entra') throw new Error('Microsoft sign-in is not enabled.')
	if (!auth.clientId?.trim()) throw new Error('Microsoft sign-in client ID is missing.')
	const redirectUri = auth.redirectUri?.trim()
	if (!redirectUri) throw new Error('Microsoft sign-in callback URI is missing.')
	const redirect = new URL(redirectUri)
	const expected = new URL(origin)
	if (
		redirect.origin !== expected.origin ||
		redirect.pathname !== '/auth/callback' ||
		redirect.search ||
		redirect.hash
	) {
		throw new Error('Microsoft sign-in callback URI is invalid.')
	}
	return {
		auth: {
			clientId: auth.clientId.trim(),
			authority: redirectAuthority(auth),
			redirectUri,
		},
		cache: { cacheLocation: 'sessionStorage' },
	}
}

export function getMsal(auth: PublicRuntimeContract['auth']): Promise<MsalLike> {
	const key = JSON.stringify(msalConfiguration(auth))
	if (instance?.key === key) return instance.ready
	const application = new PublicClientApplication(msalConfiguration(auth)) as unknown as MsalLike
	const ready = Promise.resolve(application.initialize?.())
		.then(() => application)
		.catch((error: unknown) => {
			if (instance?.ready === ready) instance = null
			throw error
		})
	instance = { key, ready }
	return ready
}

export async function loginWithMsal(auth: PublicRuntimeContract['auth']): Promise<void> {
	const msal = await getMsal(auth)
	await msal.handleRedirectPromise({ navigateToLoginRequestUrl: false })
	await msal.loginRedirect({
		scopes: MSAL_SCOPES,
		redirectStartPage: `${window.location.origin}/`,
	})
}

export async function resolveMsalRedirect(
	msal: MsalLike,
	location: { hash: string; search: string } = {
		hash: typeof window === 'undefined' ? '' : window.location.hash,
		search: typeof window === 'undefined' ? '' : window.location.search,
	},
): Promise<MsalRedirectResult> {
	const result = await msal.handleRedirectPromise({ navigateToLoginRequestUrl: false })
	if (result) {
		if (!result.idToken)
			throw new Error('Microsoft did not return an ID token. Try signing in again.')
		if (result.account) msal.setActiveAccount?.(result.account)
		return result
	}

	const params = [location.hash, location.search]
		.map((value) => new URLSearchParams(value.replace(/^#|^\?/, '')))
		.find((value) => value.has('code') || value.has('error'))
	if (params?.has('error')) {
		const description = params.get('error_description')?.replaceAll('+', ' ').trim()
		throw new Error(description || 'Microsoft sign-in was cancelled or failed.')
	}

	const accounts = msal.getAllAccounts()
	const account = msal.getActiveAccount() ?? (accounts.length === 1 ? accounts[0] : null)
	if (!account) {
		throw new Error(
			params?.has('code')
				? 'Microsoft sign-in could not be resumed. Try signing in again.'
				: 'No Microsoft sign-in result was found. Try signing in again.',
		)
	}
	const silent = await msal.acquireTokenSilent({ account, scopes: MSAL_SCOPES })
	if (!silent.idToken)
		throw new Error('Microsoft did not return an ID token. Try signing in again.')
	return silent
}

export async function completeMsalRedirect(
	auth: PublicRuntimeContract['auth'],
): Promise<MsalRedirectResult> {
	const msal = await getMsal(auth)
	return resolveMsalRedirect(msal)
}

async function establishCallbackSession(
	auth: PublicRuntimeContract['auth'],
): Promise<ServerSession> {
	const result = await completeMsalRedirect(auth)
	const response = await fetch('/api/auth/session', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ id_token: result.idToken }),
	})
	if (response.status !== 204) {
		throw new Error(
			response.status >= 500
				? 'Sign-in succeeded, but the workspace could not verify the session. Try again in a moment.'
				: 'Your Microsoft session could not be verified. Please sign in again.',
		)
	}
	const session = await fetchSession()
	if (!session.user || sessionExpired(session)) {
		throw new Error('Your workspace session was not established. Please sign in again.')
	}
	return session
}

export function completeCallback(auth: PublicRuntimeContract['auth']): Promise<ServerSession> {
	const key = JSON.stringify(msalConfiguration(auth))
	if (callbackCompletion?.key === key) return callbackCompletion.promise
	const promise = establishCallbackSession(auth)
	callbackCompletion = { key, promise }
	return promise
}

export async function clearMsalCache(auth: PublicRuntimeContract['auth']): Promise<void> {
	callbackCompletion = null
	try {
		const msal = await getMsal(auth)
		await msal.clearCache()
	} finally {
		instance = null
	}
}
