import { loadAiConfig } from '../../src/server/aiConfig.ts'
import { parseCidrList } from '../../src/server/ipAllowlist.ts'
import type { AuthMode } from '../../src/shared/runtime.ts'

export interface AzureTarget {
	subscriptionId: string
	tenantId: string
	resourceGroup: string
	location: string
	registry: string
	identity: string
	environment: string
	app: string
	authMode: AuthMode
	authTenantId?: string
	authClientId?: string
	allowedObjectIds?: string
	aiEnabled: boolean
	aiIpAllowlist?: string
	storage?: {
		pgHost: string
		pgDatabase: string
		pgUser: string
		pgPort: string
		storageAccount: string
		storageContainer: string
		clientId: string
	}
	ai?: {
		clientId: string
		baseURL: string
		model: string
		maiHost: string
		maiDeployment: string
		lectureReasoning: string
	}
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
	if (authMode !== 'none' && authMode !== 'entra' && authMode !== 'demo') {
		throw new Error('Set MICO_AUTH_MODE explicitly to none, demo, or entra')
	}
	const aiEnabled = env.MICO_AI_ENABLED?.trim() || 'false'
	if (aiEnabled !== 'true' && aiEnabled !== 'false')
		throw new Error('MICO_AI_ENABLED must be true or false')
	const rawAllowlist = env.MICO_AI_IP_ALLOWLIST?.trim()
	if (rawAllowlist) parseCidrList(rawAllowlist)
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
		aiEnabled: aiEnabled === 'true',
		aiIpAllowlist: rawAllowlist || undefined,
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
	if (target.aiEnabled) {
		if (env.MICO_AI_AUTH_MODE !== 'managed-identity')
			throw new Error('Azure AI deployment requires MICO_AI_AUTH_MODE=managed-identity')
		if (env.MICO_MOSS_ENABLED && env.MICO_MOSS_ENABLED !== 'false')
			throw new Error('MOSS is not enabled by the Azure adapter')
		const config = loadAiConfig({
			MICO_RUNTIME: 'deploy',
			MICO_AI_ENABLED: 'true',
			MICO_AI_AUTH_MODE: 'managed-identity',
			MICO_MOSS_ENABLED: 'false',
			AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
			MAGPIE_BASE_URL: env.MAGPIE_BASE_URL,
			MAGPIE_MODEL: env.MAGPIE_MODEL,
			MAGPIE_LECTURE_REASONING: env.MAGPIE_LECTURE_REASONING,
			AZURE_MAI_HOST: env.AZURE_MAI_HOST,
			AZURE_OPENAI_DEPLOYMENT: env.AZURE_OPENAI_DEPLOYMENT,
		})
		if (!config.mai.host || !config.mai.deployment)
			throw new Error('Azure AI deployment requires AZURE_MAI_HOST and AZURE_OPENAI_DEPLOYMENT')
		target.ai = {
			clientId: config.azureClientId as string,
			baseURL: config.chat.baseURL,
			model: config.chat.model,
			maiHost: config.mai.host,
			maiDeployment: config.mai.deployment,
			lectureReasoning: config.lectureReasoning,
		}
	}
	if (env.MICO_STORAGE_BACKEND?.trim().toLowerCase() === 'azure') {
		const pgHost = env.MICO_PG_HOST?.trim()
		const pgDatabase = env.MICO_PG_DATABASE?.trim() || 'mico'
		const pgUser = env.MICO_PG_USER?.trim()
		const pgPort = env.MICO_PG_PORT?.trim() || '5432'
		const storageAccount = env.MICO_AZURE_STORAGE_ACCOUNT?.trim()
		const storageContainer = env.MICO_AZURE_STORAGE_CONTAINER?.trim() || 'mico-assets'
		const clientId = env.AZURE_CLIENT_ID?.trim()
		if (!pgHost || !pgUser || !storageAccount || !clientId) {
			throw new Error(
				'Azure persistent storage requires MICO_PG_HOST, MICO_PG_USER, MICO_AZURE_STORAGE_ACCOUNT, and AZURE_CLIENT_ID',
			)
		}
		target.storage = {
			pgHost,
			pgDatabase,
			pgUser,
			pgPort,
			storageAccount,
			storageContainer,
			clientId,
		}
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
		MICO_AI_ENABLED: String(target.aiEnabled),
		MICO_MOSS_ENABLED: 'false',
		MICO_EPHEMERAL: target.storage ? 'false' : 'true',
		MICO_AUTH_MODE: target.authMode,
	}
	if (target.storage) {
		env.MICO_STORAGE_BACKEND = 'azure'
		env.MICO_PG_AUTH_MODE = 'managed-identity'
		env.MICO_PG_HOST = target.storage.pgHost
		env.MICO_PG_PORT = target.storage.pgPort
		env.MICO_PG_DATABASE = target.storage.pgDatabase
		env.MICO_PG_USER = target.storage.pgUser
		env.MICO_PG_SSL = 'true'
		env.MICO_AZURE_STORAGE_ACCOUNT = target.storage.storageAccount
		env.MICO_AZURE_STORAGE_CONTAINER = target.storage.storageContainer
		env.AZURE_CLIENT_ID = target.storage.clientId
	}
	if (target.aiIpAllowlist) {
		env.MICO_AI_IP_ALLOWLIST = target.aiIpAllowlist
	}
	if (target.ai) {
		env.MICO_AI_AUTH_MODE = 'managed-identity'
		env.AZURE_CLIENT_ID = target.ai.clientId
		env.MAGPIE_BASE_URL = target.ai.baseURL
		env.MAGPIE_MODEL = target.ai.model
		env.MAGPIE_LECTURE_REASONING = target.ai.lectureReasoning
		env.AZURE_MAI_HOST = target.ai.maiHost
		env.AZURE_OPENAI_DEPLOYMENT = target.ai.maiDeployment
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
		name: target.app,
		type: 'Microsoft.App/containerApps',
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
