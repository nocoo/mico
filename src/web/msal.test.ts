import assert from 'node:assert/strict'
import test from 'node:test'
import { type MsalLike, msalConfiguration, resolveMsalRedirect } from './msal.ts'

const entra = {
	mode: 'entra' as const,
	clientId: 'browser-test-client',
	tenantId: 'test-tenant-id',
	authority: 'https://login.microsoftonline.com/test-tenant-id',
	redirectUri: 'https://mico.example/auth/callback',
}

function mockMsal(overrides: Partial<MsalLike> = {}): MsalLike {
	return {
		handleRedirectPromise: async () => null,
		loginRedirect: async () => undefined,
		clearCache: async () => undefined,
		getAllAccounts: () => [],
		getActiveAccount: () => null,
		acquireTokenSilent: async () => ({ idToken: 'fallback-token' }),
		...overrides,
	}
}

test('MSAL configuration rejects common authority and mismatched callback origins', () => {
	assert.throws(
		() =>
			msalConfiguration(
				{ ...entra, authority: 'https://login.microsoftonline.com/common' },
				'https://mico.example',
			),
		/common|tenant/i,
	)
	assert.throws(() => msalConfiguration(entra, 'https://different.example'), /callback/i)
	assert.throws(() => msalConfiguration({ mode: 'entra' }, 'https://mico.example'), /client/i)
})

test('MSAL configuration accepts a configured tenant and exact callback', () => {
	const config = msalConfiguration(entra, 'https://mico.example')
	assert.equal(config.auth?.clientId, 'browser-test-client')
	assert.equal(config.auth?.authority, 'https://login.microsoftonline.com/test-tenant-id')
	assert.equal(config.auth?.redirectUri, 'https://mico.example/auth/callback')
	assert.equal(config.cache?.cacheLocation, 'sessionStorage')
})

test('callback response with an ID token sets the active account', async () => {
	let active = null as unknown
	let redirectOptions = null as unknown
	const msal = mockMsal({
		handleRedirectPromise: async (options) => {
			redirectOptions = options
			return {
				idToken: 'redirect-token',
				account: { homeAccountId: 'account-1' },
			}
		},
		setActiveAccount: (account) => {
			active = account
		},
	})
	const result = await resolveMsalRedirect(msal, { hash: '#code=test', search: '' })
	assert.equal(result.idToken, 'redirect-token')
	assert.equal((active as { homeAccountId?: string } | null)?.homeAccountId, 'account-1')
	assert.equal(
		(redirectOptions as { navigateToLoginRequestUrl: boolean }).navigateToLoginRequestUrl,
		false,
	)
})

test('callback with no redirect result resumes one cached account silently', async () => {
	let silentRequest = null as unknown
	const msal = mockMsal({
		getAllAccounts: () => [{ homeAccountId: 'account-1' }],
		acquireTokenSilent: async (request) => {
			silentRequest = request
			return { idToken: 'silent-token' }
		},
	})
	const result = await resolveMsalRedirect(msal, { hash: '#code=test', search: '' })
	assert.equal(result.idToken, 'silent-token')
	assert.equal((silentRequest as { scopes: string[] }).scopes.includes('openid'), true)
})

test('callback rejects error responses, missing accounts, and missing tokens', async () => {
	await assert.rejects(
		resolveMsalRedirect(mockMsal({ handleRedirectPromise: async () => null }), {
			hash: '#error=access_denied&error_description=User+cancelled',
			search: '',
		}),
		/User cancelled|cancelled/i,
	)
	await assert.rejects(
		resolveMsalRedirect(mockMsal(), { hash: '#code=test', search: '' }),
		/could not be resumed/i,
	)
	await assert.rejects(
		resolveMsalRedirect(mockMsal({ handleRedirectPromise: async () => ({ idToken: '' }) }), {
			hash: '',
			search: '',
		}),
		/ID token/i,
	)
	await assert.rejects(
		resolveMsalRedirect(
			mockMsal({
				getAllAccounts: () => [{ homeAccountId: 'account-1' }],
				acquireTokenSilent: async () => ({ idToken: '' }),
			}),
			{ hash: '', search: '' },
		),
		/ID token/i,
	)
})
