import { createHash } from 'node:crypto'
import type { AuthMode } from '../shared/runtime.ts'
import { DEMO_TENANT, LOCAL_TENANT, type TenantScope } from './store.ts'

export { DEMO_TENANT } from './store.ts'

export function tenantScopeFor(
	session: { identity: string } | undefined,
	authMode: AuthMode = 'none',
): TenantScope {
	if (authMode === 'demo') return DEMO_TENANT
	if (!session) return LOCAL_TENANT
	const digest = createHash('sha256').update(session.identity).digest('hex')
	return { tenantId: `ten-${digest.slice(0, 32)}` }
}
