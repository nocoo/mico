import type { PublicRuntimeContract } from '../shared/runtime'

export interface RuntimeConfig extends PublicRuntimeContract {
	mossEnabled: boolean
}

export function parseRuntimeConfig(body: unknown): RuntimeConfig {
	if (!body || typeof body !== 'object') throw new Error('Runtime configuration is invalid.')
	const runtime = body as Record<string, unknown>
	if (!runtime.auth || typeof runtime.auth !== 'object') {
		throw new Error('Runtime configuration is invalid.')
	}
	const auth = runtime.auth as Record<string, unknown>
	if (auth.mode !== 'none' && auth.mode !== 'entra') {
		throw new Error('Runtime configuration is invalid.')
	}
	if (
		typeof runtime.aiEnabled !== 'boolean' ||
		typeof runtime.aiSettingsVisible !== 'boolean' ||
		typeof runtime.ephemeral !== 'boolean' ||
		typeof runtime.mossEnabled !== 'boolean'
	) {
		throw new Error('Runtime configuration is invalid.')
	}
	return body as RuntimeConfig
}

export interface ServerSession {
	user: { name: string; expiresAt: number } | null
}

export async function fetchRuntime(signal?: AbortSignal): Promise<RuntimeConfig> {
	const response = await fetch('/api/runtime', { cache: 'no-store', signal })
	if (!response.ok) throw new Error('Runtime configuration could not be loaded.')
	return parseRuntimeConfig(await response.json())
}

export async function fetchSession(signal?: AbortSignal): Promise<ServerSession> {
	const response = await fetch('/api/auth/session', { cache: 'no-store', signal })
	if (response.status === 401) return { user: null }
	if (!response.ok) throw new Error('Session could not be verified.')
	return (await response.json()) as ServerSession
}

export function expiresAtMilliseconds(expiresAt: number): number {
	return expiresAt
}

export function sessionExpired(session: ServerSession, now = Date.now()): boolean {
	return Boolean(session.user && expiresAtMilliseconds(session.user.expiresAt) <= now)
}
