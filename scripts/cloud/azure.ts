export interface AzureTarget {
	subscriptionId: string
	tenantId: string
	resourceGroup: string
	location: string
	registry: string
	identity: string
	environment: string
	app: string
	authMode: 'none' | 'entra'
	authTenantId?: string
	authClientId?: string
	allowedObjectIds?: string
}

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i

export function azureTarget(env: NodeJS.ProcessEnv): AzureTarget {
	const required = (name: string, pattern: RegExp): string => {
		const value = env[name]?.trim() ?? ''
		if (!pattern.test(value)) throw new Error(`Missing or invalid ${name}`)
		return value
	}
	const name = /^[a-z][a-z\d-]{1,30}[a-z\d]$/
	const authMode = env.MICO_AUTH_MODE
	if (authMode !== 'none' && authMode !== 'entra') {
		throw new Error('Set MICO_AUTH_MODE explicitly to none or entra')
	}
	const target: AzureTarget = {
		subscriptionId: required('MICO_AZ_SUBSCRIPTION_ID', UUID),
		tenantId: required('MICO_AZ_TENANT_ID', UUID),
		resourceGroup: required('MICO_AZ_RESOURCE_GROUP', /^[\w().-]{1,90}$/),
		location: required('MICO_AZ_LOCATION', /^[a-z\d]+$/),
		registry: required('MICO_AZ_REGISTRY', /^[a-z][a-z\d]{4,49}$/),
		identity: required('MICO_AZ_IDENTITY', name),
		environment: required('MICO_AZ_ENVIRONMENT', name),
		app: required('MICO_AZ_APP', name),
		authMode,
	}
	if (authMode === 'entra') {
		target.authTenantId = required('MICO_AUTH_TENANT_ID', UUID)
		target.authClientId = required('MICO_AUTH_CLIENT_ID', UUID)
		const ids = env.MICO_AUTH_ALLOWED_OBJECT_IDS?.split(',').map((id) => id.trim()) ?? []
		if (ids.length === 0 || ids.some((id) => !UUID.test(id))) {
			throw new Error('Missing or invalid MICO_AUTH_ALLOWED_OBJECT_IDS')
		}
		target.allowedObjectIds = ids.join(',')
	}
	return target
}

export function azureOrigin(target: AzureTarget, defaultDomain: string): string {
	if (!/^[a-z\d.-]+\.azurecontainerapps\.io$/.test(defaultDomain)) {
		throw new Error('Invalid Container Apps environment domain')
	}
	return `https://${target.app}.${defaultDomain}`
}

export function containerApp(
	target: AzureTarget,
	input: {
		environmentId: string
		identityId: string
		registryServer: string
		digest: string
		origin: string
	},
) {
	if (!/^sha256:[a-f\d]{64}$/.test(input.digest)) throw new Error('Invalid image digest')
	const env: Record<string, string> = {
		MICO_RUNTIME: 'deploy',
		MICO_HOST: '0.0.0.0',
		MICO_PORT: '47063',
		MICO_STATIC_DIR: '/app/dist',
		MICO_DB_PATH: '/tmp/mico/board.sqlite',
		MICO_PUBLIC_ORIGIN: input.origin,
		MICO_AI_ENABLED: 'false',
		MICO_EPHEMERAL: 'true',
		MICO_AUTH_MODE: target.authMode,
	}
	if (target.authMode === 'entra') {
		env.MICO_AUTH_TENANT_ID = target.authTenantId as string
		env.MICO_AUTH_CLIENT_ID = target.authClientId as string
		env.MICO_AUTH_ALLOWED_OBJECT_IDS = target.allowedObjectIds as string
	}
	const probe = {
		httpGet: {
			path: '/api/live',
			port: 47063,
			scheme: 'HTTP',
			httpHeaders: [{ name: 'Host', value: 'localhost:47063' }],
		},
		periodSeconds: 10,
		timeoutSeconds: 3,
		failureThreshold: 3,
	}
	return {
		location: target.location,
		identity: { type: 'UserAssigned', userAssignedIdentities: { [input.identityId]: {} } },
		properties: {
			managedEnvironmentId: input.environmentId,
			configuration: {
				activeRevisionsMode: 'Single',
				ingress: {
					external: true,
					allowInsecure: false,
					targetPort: 47063,
					transport: 'auto',
					traffic: [{ latestRevision: true, weight: 100 }],
				},
				registries: [{ server: input.registryServer, identity: input.identityId }],
			},
			template: {
				containers: [
					{
						name: 'web',
						image: `${input.registryServer}/mico@${input.digest}`,
						resources: { cpu: 0.5, memory: '1Gi' },
						env: Object.entries(env).map(([name, value]) => ({ name, value })),
						probes: [
							{ ...probe, type: 'Startup', failureThreshold: 30 },
							{ ...probe, type: 'Liveness' },
							{ ...probe, type: 'Readiness' },
						],
					},
				],
				scale: { minReplicas: 1, maxReplicas: 1 },
			},
		},
	}
}
