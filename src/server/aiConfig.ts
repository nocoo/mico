import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { isMossEnabled } from '../shared/runtime.ts'

export type RuntimeMode = 'laptop' | 'deploy'

export type AiAuthMode = 'api-key' | 'managed-identity'

export interface ChatSettings {
	baseURL: string
	model: string
	apiKey: string
	authMode: AiAuthMode
}

export interface ImageProviderConfig {
	endpoint: string
	apiKey: string
	model: string
}

export interface AiConfig {
	runtime: RuntimeMode
	authMode: AiAuthMode
	azureClientId?: string
	chat: ChatSettings
	lectureReasoning: string
	mai: { host: string; apiKey: string; deployment: string }
	image: ImageProviderConfig
	moss: { url: string; apiKey: string }
}

export const DEFAULT_CHAT_BASE_URL = 'http://127.0.0.1:3425/v1'
export const DEFAULT_CHAT_MODEL = 'auto/gpt-6-luna'
export const DEFAULT_CHAT_API_KEY = 'magpie'
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-flare'
export const DEFAULT_MOSS_URL = 'wss://api.mosi.cn/v1/realtime?model=moss-live-1.0'

const AZURE_AI_RESOURCE_SUFFIXES = [
	'.services.ai.azure.com',
	'.openai.azure.com',
	'.cognitiveservices.azure.com',
]

export function isAllowedAzureAiHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/[.]$/, '')
	return AZURE_AI_RESOURCE_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

function endpoint(value: string, name: string, protocols = ['http:', 'https:']): string {
	if (!value) return ''
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error(`Invalid ${name}`)
	}
	if (
		value.length > 2048 ||
		!protocols.includes(url.protocol) ||
		url.username ||
		url.password ||
		url.hash ||
		(protocols.includes('http:') && url.search)
	) {
		throw new Error(`Invalid ${name}`)
	}
	return protocols.includes('http:') ? value.replace(/\/+$/, '') : value
}

function apiKey(env: NodeJS.ProcessEnv, name: string, defaultValue = ''): string {
	const value = env[name] ?? defaultValue
	if (value.length > 4096 || /[\r\n]/.test(value)) throw new Error(`Invalid ${name}`)
	return value
}

export function loadImageConfig(env: NodeJS.ProcessEnv = process.env): ImageProviderConfig {
	return {
		endpoint: endpoint(env.AZURE_OPENAI_ENDPOINT?.trim() ?? '', 'AZURE_OPENAI_ENDPOINT'),
		apiKey: apiKey(env, 'AZURE_OPENAI_API_KEY'),
		model: env.AZURE_OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL,
	}
}

export function runtimeMode(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
	const runtime = env.MICO_RUNTIME?.trim() || 'laptop'
	if (runtime !== 'laptop' && runtime !== 'deploy') {
		throw new Error('MICO_RUNTIME must be laptop or deploy')
	}
	return runtime
}

export function loadRuntimeEnv(
	env: NodeJS.ProcessEnv = process.env,
	path = '.env',
): NodeJS.ProcessEnv {
	if (runtimeMode(env) === 'deploy') return { ...env }
	let local: NodeJS.ProcessEnv
	try {
		local = parseEnv(readFileSync(path, 'utf8'))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...env }
		throw new Error('Could not read local environment file')
	}
	const merged = { ...local, ...env }
	if (runtimeMode(merged) !== 'laptop') {
		throw new Error('MICO_RUNTIME=deploy must be set in the process environment')
	}
	return merged
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
	const runtime = runtimeMode(env)
	const aiEnabledRaw = env.MICO_AI_ENABLED?.trim()
	if (aiEnabledRaw && aiEnabledRaw !== 'true' && aiEnabledRaw !== 'false') {
		throw new Error('MICO_AI_ENABLED must be true or false')
	}
	const aiEnabled = aiEnabledRaw !== 'false'
	const aiAuthMode = env.MICO_AI_AUTH_MODE?.trim() || 'api-key'
	if (aiAuthMode !== 'api-key' && aiAuthMode !== 'managed-identity') {
		throw new Error('MICO_AI_AUTH_MODE must be api-key or managed-identity')
	}
	const azureClientId = env.AZURE_CLIENT_ID?.trim() || undefined
	if (aiEnabled && aiAuthMode === 'managed-identity') {
		if (!azureClientId)
			throw new Error('AZURE_CLIENT_ID is required when managed identity AI is enabled')
		if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(azureClientId)) {
			throw new Error('AZURE_CLIENT_ID must be a GUID')
		}
	}
	if (!aiEnabled) {
		return {
			runtime,
			authMode: aiAuthMode,
			azureClientId,
			chat: { baseURL: '', model: '', apiKey: '', authMode: aiAuthMode },
			lectureReasoning: 'none',
			mai: { host: '', apiKey: '', deployment: '' },
			image: { endpoint: '', apiKey: '', model: DEFAULT_IMAGE_MODEL },
			moss: { url: '', apiKey: '' },
		}
	}
	const local = runtime === 'laptop' && aiAuthMode === 'api-key'
	const baseURL = env.MAGPIE_BASE_URL?.trim() || (local ? DEFAULT_CHAT_BASE_URL : '')
	const model = env.MAGPIE_MODEL?.trim() || (local ? DEFAULT_CHAT_MODEL : '')
	if (!local && (!baseURL || !model)) {
		throw new Error(
			'MAGPIE_BASE_URL and MAGPIE_MODEL are required for deployed or managed identity AI',
		)
	}
	const host = env.AZURE_MAI_HOST?.trim() ?? ''
	if (host) {
		const url = new URL(endpoint(`https://${host}`, 'AZURE_MAI_HOST'))
		if (url.host !== host || url.pathname !== '/') throw new Error('Invalid AZURE_MAI_HOST')
		if (aiAuthMode === 'managed-identity' && (url.port || !isAllowedAzureAiHost(url.hostname))) {
			throw new Error('AZURE_MAI resource host must use an allowed Azure AI HTTPS suffix')
		}
	}
	if (aiAuthMode === 'managed-identity' && baseURL) {
		let chatUrl: URL
		try {
			chatUrl = new URL(baseURL)
		} catch {
			throw new Error('Invalid MAGPIE_BASE_URL')
		}
		if (
			chatUrl.protocol !== 'https:' ||
			chatUrl.port ||
			chatUrl.username ||
			chatUrl.password ||
			chatUrl.search ||
			chatUrl.hash ||
			!isAllowedAzureAiHost(chatUrl.hostname)
		) {
			throw new Error('MAGPIE_BASE_URL must use an allowed Azure AI HTTPS resource host')
		}
	}
	const image = loadImageConfig(env)
	const maiApiKey = aiAuthMode === 'managed-identity' ? '' : image.apiKey
	return {
		runtime,
		authMode: aiAuthMode,
		azureClientId,
		chat: {
			baseURL: endpoint(baseURL, 'MAGPIE_BASE_URL'),
			model,
			apiKey:
				aiAuthMode === 'managed-identity'
					? ''
					: apiKey(env, 'MAGPIE_API_KEY', local ? DEFAULT_CHAT_API_KEY : ''),
			authMode: aiAuthMode,
		},
		lectureReasoning: env.MAGPIE_LECTURE_REASONING?.trim() || 'none',
		mai: {
			host,
			apiKey: maiApiKey,
			deployment: env.AZURE_OPENAI_DEPLOYMENT?.trim() || '',
		},
		image,
		moss: isMossEnabled(env)
			? {
					url: endpoint(env.MOSS_REALTIME_URL?.trim() || DEFAULT_MOSS_URL, 'MOSS_REALTIME_URL', [
						'wss:',
					]),
					apiKey: apiKey(env, 'MOSS_API_KEY'),
				}
			: { url: '', apiKey: '' },
	}
}
