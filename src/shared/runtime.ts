export type AuthMode = 'none' | 'entra'
export type RuntimeMode = 'laptop' | 'deploy'

export interface RuntimeAuthContract {
	mode: AuthMode
	clientId?: string
	tenantId?: string
	authority?: string
	redirectUri?: string
}

export interface PublicRuntimeContract {
	auth: RuntimeAuthContract
	aiEnabled: boolean
	mossEnabled: boolean
	ephemeral: boolean
}

export interface SessionContract {
	user: { name: string; expiresAt: number } | null
}

export interface RuntimeConfig {
	mode: RuntimeMode
	auth: RuntimeAuthContract
	aiEnabled: boolean
	mossEnabled: boolean
	ephemeral: boolean
	publicOrigin?: string
	allowedObjectIds: Set<string>
}

function booleanValue(
	env: NodeJS.ProcessEnv,
	name: 'MICO_AI_ENABLED' | 'MICO_MOSS_ENABLED' | 'MICO_EPHEMERAL',
): boolean {
	const raw = env[name]?.trim()
	if (!raw) return name !== 'MICO_EPHEMERAL'
	if (raw === 'true') return true
	if (raw === 'false') return false
	throw new Error(`${name} must be true or false`)
}

function canonicalOrigin(value: string, name: string): string {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error(`${name} must be an absolute HTTP or HTTPS origin`)
	}
	if (
		value.length > 2048 ||
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new Error(`${name} must be an absolute HTTP or HTTPS origin`)
	}
	return url.origin
}

export function isMossEnabled(env: NodeJS.ProcessEnv): boolean {
	return booleanValue(env, 'MICO_AI_ENABLED') && booleanValue(env, 'MICO_MOSS_ENABLED')
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
	const runtime = env.MICO_RUNTIME?.trim() || 'laptop'
	if (runtime !== 'laptop' && runtime !== 'deploy') {
		throw new Error('MICO_RUNTIME must be laptop or deploy')
	}

	const authMode = env.MICO_AUTH_MODE?.trim() || 'none'
	if (authMode !== 'none' && authMode !== 'entra') {
		throw new Error('MICO_AUTH_MODE must be none or entra')
	}

	const aiEnabled = booleanValue(env, 'MICO_AI_ENABLED')
	const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
	const mossEnabled = isMossEnabled(env)
	const ephemeral = booleanValue(env, 'MICO_EPHEMERAL')
	const publicOrigin = env.MICO_PUBLIC_ORIGIN?.trim()
		? canonicalOrigin(env.MICO_PUBLIC_ORIGIN.trim(), 'MICO_PUBLIC_ORIGIN')
		: undefined

	if (authMode === 'entra') {
		if (!publicOrigin) throw new Error('MICO_PUBLIC_ORIGIN is required when MICO_AUTH_MODE=entra')
		if (new URL(publicOrigin).protocol !== 'https:') {
			throw new Error('MICO_PUBLIC_ORIGIN must use HTTPS when MICO_AUTH_MODE=entra')
		}
		const tenantId = env.MICO_AUTH_TENANT_ID?.trim()
		const clientId = env.MICO_AUTH_CLIENT_ID?.trim()
		if (!tenantId) throw new Error('MICO_AUTH_TENANT_ID is required when MICO_AUTH_MODE=entra')
		if (!guidPattern.test(tenantId)) throw new Error('MICO_AUTH_TENANT_ID must be a GUID')
		if (!clientId) throw new Error('MICO_AUTH_CLIENT_ID is required when MICO_AUTH_MODE=entra')
		if (!guidPattern.test(clientId)) throw new Error('MICO_AUTH_CLIENT_ID must be a GUID')
		const rawAllowedObjectIds = env.MICO_AUTH_ALLOWED_OBJECT_IDS?.trim()
		if (!rawAllowedObjectIds) {
			throw new Error('MICO_AUTH_ALLOWED_OBJECT_IDS is required when MICO_AUTH_MODE=entra')
		}
		const allowedParts = rawAllowedObjectIds.split(',').map((value) => value.trim())
		if (
			allowedParts.some((value) => value.length === 0) ||
			allowedParts.some((value) => !guidPattern.test(value))
		) {
			throw new Error('MICO_AUTH_ALLOWED_OBJECT_IDS must contain comma-separated GUIDs')
		}
		const allowedObjectIds = new Set(allowedParts)
		const authority = `https://login.microsoftonline.com/${tenantId}`
		return {
			mode: runtime,
			publicOrigin,
			aiEnabled,
			mossEnabled,
			ephemeral,
			allowedObjectIds,
			auth: {
				mode: 'entra',
				clientId,
				tenantId,
				authority,
				redirectUri: `${publicOrigin}/auth/callback`,
			},
		}
	}

	return {
		mode: runtime,
		publicOrigin,
		aiEnabled,
		mossEnabled,
		ephemeral,
		allowedObjectIds: new Set(),
		auth: { mode: 'none' },
	}
}

export function publicRuntimeContract(config: RuntimeConfig): PublicRuntimeContract {
	return {
		auth: { ...config.auth },
		aiEnabled: config.aiEnabled,
		mossEnabled: config.mossEnabled,
		ephemeral: config.ephemeral,
	}
}
