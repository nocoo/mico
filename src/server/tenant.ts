import { createHash } from 'node:crypto'
import type { AuthMode } from '../shared/runtime.ts'
import { LOCAL_TENANT, type TenantScope } from './store.ts'

export const DEMO_TENANT: TenantScope = { tenantId: 'demo' }

export function tenantScopeFor(
	session: { identity: string } | undefined,
	authMode: AuthMode = 'none',
	meetingId?: string,
): TenantScope {
	if (authMode === 'demo') {
		const trimmed = meetingId?.trim()
		if (!trimmed) return DEMO_TENANT
		const digest = createHash('sha256').update(trimmed).digest('hex')
		return { tenantId: `mtg-${digest.slice(0, 24)}` }
	}
	if (!session) return LOCAL_TENANT
	const digest = createHash('sha256').update(session.identity).digest('hex')
	return { tenantId: `ten-${digest.slice(0, 32)}` }
}
