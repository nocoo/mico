import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose'
import WebSocket from 'ws'
import type { RuntimeConfig } from '../shared/runtime.ts'
import { OperationError } from './store.ts'

export interface AuthSession {
	name: string
	expiresAt: number
	sockets: Set<WebSocket>
}

export interface VerifiedSession {
	name: string
	expiresAt: number
}

export class AuthManager {
	private readonly sessions = new Map<string, AuthSession>()
	private readonly sessionTimers = new Map<string, ReturnType<typeof setTimeout>>()
	private readonly resolver: JWTVerifyGetKey | undefined
	private readonly runtimeConfig: RuntimeConfig

	constructor(runtimeConfig: RuntimeConfig, authJwksResolver?: JWTVerifyGetKey) {
		this.runtimeConfig = runtimeConfig
		this.resolver =
			authJwksResolver ??
			(runtimeConfig.auth.mode === 'entra'
				? createRemoteJWKSet(
						new URL(
							`https://login.microsoftonline.com/${runtimeConfig.auth.tenantId}/discovery/v2.0/keys`,
						),
					)
				: undefined)
	}

	getSession(req: IncomingMessage): AuthSession | undefined {
		const token = this.parseSessionCookie(req)
		if (!token) return undefined
		const session = this.sessions.get(token)
		if (!session) return undefined
		if (session.expiresAt <= Date.now()) {
			this.revokeSession(token)
			return undefined
		}
		return session
	}

	parseSessionCookie(req: IncomingMessage): string | undefined {
		const cookie = req.headers.cookie
		if (!cookie) return undefined
		for (const part of cookie.split(';')) {
			const separator = part.indexOf('=')
			if (separator < 0) continue
			const name = part.slice(0, separator).trim()
			if (name === '__Host-mico-session') return part.slice(separator + 1).trim()
		}
		return undefined
	}

	async verifyIdToken(idToken: string): Promise<VerifiedSession> {
		if (!this.resolver) {
			throw new OperationError(
				503,
				'AUTH_CONFIG_UNAVAILABLE',
				'Authentication verifier is unavailable',
			)
		}
		try {
			const verified = await jwtVerify<{
				name?: unknown
				preferred_username?: unknown
				oid?: unknown
				tid?: unknown
				exp?: unknown
			}>(idToken, this.resolver, {
				algorithms: ['RS256'],
				audience: this.runtimeConfig.auth.clientId,
				issuer: `https://login.microsoftonline.com/${this.runtimeConfig.auth.tenantId}/v2.0`,
			})
			if (
				typeof verified.payload.tid !== 'string' ||
				verified.payload.tid !== this.runtimeConfig.auth.tenantId
			) {
				throw new OperationError(401, 'UNAUTHENTICATED', 'Tenant is not allowed')
			}
			if (
				typeof verified.payload.oid !== 'string' ||
				!this.runtimeConfig.allowedObjectIds.has(verified.payload.oid)
			) {
				throw new OperationError(401, 'UNAUTHENTICATED', 'User is not allowed')
			}
			if (typeof verified.payload.exp !== 'number') {
				throw new OperationError(401, 'UNAUTHENTICATED', 'Token expiration is missing')
			}
			const expiresAt = verified.payload.exp * 1000
			if (expiresAt <= Date.now()) {
				throw new OperationError(401, 'UNAUTHENTICATED', 'Token has expired')
			}
			const name =
				typeof verified.payload.name === 'string' && verified.payload.name.trim()
					? verified.payload.name.trim()
					: typeof verified.payload.preferred_username === 'string' &&
							verified.payload.preferred_username.trim()
						? verified.payload.preferred_username.trim()
						: verified.payload.oid
			return { name, expiresAt }
		} catch (error) {
			if (error instanceof OperationError) throw error
			throw new OperationError(401, 'UNAUTHENTICATED', 'ID token verification failed')
		}
	}

	issueSession(name: string, expiresAt: number): string {
		if (this.sessions.size >= 1000) {
			const oldest = this.sessions.keys().next().value as string | undefined
			if (oldest) this.revokeSession(oldest)
		}
		const token = randomBytes(32).toString('base64url')
		this.sessions.set(token, { name, expiresAt, sockets: new Set() })
		const timer = setTimeout(() => this.revokeSession(token), Math.max(0, expiresAt - Date.now()))
		timer.unref()
		this.sessionTimers.set(token, timer)
		return token
	}

	revokeRequest(req: IncomingMessage): void {
		const token = this.parseSessionCookie(req)
		if (token) this.revokeSession(token)
	}

	attachSocket(req: IncomingMessage, socket: WebSocket): void {
		const token = this.parseSessionCookie(req)
		if (!token) return
		const session = this.sessions.get(token)
		if (!session) return
		session.sockets.add(socket)
		socket.once('close', () => session.sockets.delete(socket))
	}

	setSessionCookie(res: ServerResponse, token: string, expiresAt: number): void {
		const maxAge = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
		res.setHeader(
			'Set-Cookie',
			`__Host-mico-session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
		)
	}

	clearSessionCookie(res: ServerResponse): void {
		res.setHeader(
			'Set-Cookie',
			'__Host-mico-session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
		)
	}

	close(): void {
		for (const timer of this.sessionTimers.values()) clearTimeout(timer)
		this.sessionTimers.clear()
		for (const session of this.sessions.values()) {
			for (const socket of session.sockets) socket.terminate()
		}
		this.sessions.clear()
	}

	private revokeSession(token: string): void {
		const session = this.sessions.get(token)
		if (!session) return
		for (const socket of session.sockets) {
			if (socket.readyState === WebSocket.OPEN) socket.close(1008, 'Session revoked')
		}
		this.sessions.delete(token)
		const timer = this.sessionTimers.get(token)
		if (timer) clearTimeout(timer)
		this.sessionTimers.delete(token)
	}
}
