import type { PublicRuntimeContract } from '../shared/runtime'

export type RuntimeConfig = PublicRuntimeContract

export interface ServerSession {
	user: { name: string; expiresAt: number } | null
}

export async function fetchRuntime(signal?: AbortSignal): Promise<RuntimeConfig> {
	const response = await fetch('/api/runtime', { cache: 'no-store', signal })
	if (!response.ok) throw new Error('Runtime configuration could not be loaded.')
	const runtime = (await response.json()) as RuntimeConfig
	if (!runtime.auth || (runtime.auth.mode !== 'none' && runtime.auth.mode !== 'entra')) {
		throw new Error('Runtime configuration is invalid.')
	}
	if (typeof runtime.aiEnabled !== 'boolean' || typeof runtime.ephemeral !== 'boolean') {
		throw new Error('Runtime configuration is invalid.')
	}
	return runtime
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
