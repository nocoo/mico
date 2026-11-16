import { createHash } from 'node:crypto'
import type { AuthMode } from '../shared/runtime.ts'
import { LOCAL_TENANT, type TenantScope } from './store.ts'

export const DEMO_TENANT: TenantScope = { tenantId: 'demo' }

export function tenantScopeFor(
	session: { identity: string } | undefined,
	authMode: AuthMode = 'none',
): TenantScope {
	if (authMode === 'demo') return DEMO_TENANT
	if (!session) return LOCAL_TENANT
	const digest = createHash('sha256').update(session.identity).digest('hex')
	return { tenantId: `ten-${digest.slice(0, 32)}` }
}
