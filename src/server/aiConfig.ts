import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

export type RuntimeMode = 'laptop' | 'deploy'

export interface ChatSettings {
	baseURL: string
	model: string
	apiKey: string
}

export interface ImageProviderConfig {
	endpoint: string
	apiKey: string
	model: string
}

export interface AiConfig {
	runtime: RuntimeMode
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
	if (!aiEnabled) {
		return {
			runtime,
			chat: { baseURL: '', model: '', apiKey: '' },
			lectureReasoning: 'none',
			mai: { host: '', apiKey: '', deployment: '' },
			image: { endpoint: '', apiKey: '', model: DEFAULT_IMAGE_MODEL },
			moss: { url: '', apiKey: '' },
		}
	}
	const local = runtime === 'laptop'
	const baseURL = env.MAGPIE_BASE_URL?.trim() || (local ? DEFAULT_CHAT_BASE_URL : '')
	const model = env.MAGPIE_MODEL?.trim() || (local ? DEFAULT_CHAT_MODEL : '')
	if (!local && (!baseURL || !model)) {
		throw new Error('MAGPIE_BASE_URL and MAGPIE_MODEL are required when MICO_RUNTIME=deploy')
	}
	const host = env.AZURE_MAI_HOST?.trim() ?? ''
	if (host) {
		const url = new URL(endpoint(`https://${host}`, 'AZURE_MAI_HOST'))
		if (url.host !== host || url.pathname !== '/') throw new Error('Invalid AZURE_MAI_HOST')
	}
	const image = loadImageConfig(env)
	return {
		runtime,
		chat: {
			baseURL: endpoint(baseURL, 'MAGPIE_BASE_URL'),
			model,
			apiKey: apiKey(env, 'MAGPIE_API_KEY', local ? DEFAULT_CHAT_API_KEY : ''),
		},
		lectureReasoning: env.MAGPIE_LECTURE_REASONING?.trim() || 'none',
		mai: {
			host,
			apiKey: image.apiKey,
			deployment: env.AZURE_OPENAI_DEPLOYMENT?.trim() ?? '',
		},
		image,
		moss: {
			url: endpoint(env.MOSS_REALTIME_URL?.trim() || DEFAULT_MOSS_URL, 'MOSS_REALTIME_URL', [
				'wss:',
			]),
			apiKey: apiKey(env, 'MOSS_API_KEY'),
		},
	}
}
