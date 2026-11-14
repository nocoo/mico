import { createHash } from 'node:crypto'
import { LOCAL_TENANT, type TenantScope } from './store.ts'

export function tenantScopeFor(session: { identity: string } | undefined): TenantScope {
	if (!session) return LOCAL_TENANT
	const digest = createHash('sha256').update(session.identity).digest('hex')
	return { tenantId: `ten-${digest.slice(0, 32)}` }
}
