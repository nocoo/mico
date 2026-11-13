import { randomUUID } from 'node:crypto'
import { chmodSync, readFileSync } from 'node:fs'
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { type AiConfig, type ChatSettings, loadAiConfig } from './aiConfig.ts'
import { OperationError } from './store.ts'

export const AI_SETTINGS_DIRECTORY = join(homedir(), '.config', 'mico')
export const AI_SETTINGS_PATH = join(AI_SETTINGS_DIRECTORY, 'settings.json')

export interface PublicAiSettings {
	baseURL: string
	model: string
	hasApiKey: boolean
	readOnly: boolean
}

export interface AiSettingsStoreOptions {
	path?: string
	config?: AiConfig
	persist?: boolean
	aiEnabled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
	throw new OperationError(400, 'INVALID_REQUEST', message)
}

function validateBaseURL(value: unknown): string {
	if (typeof value !== 'string') invalid('baseURL must be a string')
	const trimmed = value.trim()
	if (trimmed.length === 0 || trimmed.length > 2048) {
		invalid('baseURL must be a non-empty string up to 2048 characters')
	}
	let url: URL
	try {
		url = new URL(trimmed)
	} catch {
		invalid('baseURL must be an absolute HTTP or HTTPS URL')
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
		invalid('baseURL must be an absolute HTTP or HTTPS URL')
	}
	return trimmed.replace(/\/+$/, '')
}

function validateModel(value: unknown): string {
	if (typeof value !== 'string') invalid('model must be a string')
	const trimmed = value.trim()
	if (trimmed.length === 0 || trimmed.length > 256) {
		invalid('model must be a non-empty string up to 256 characters')
	}
	return trimmed
}

function validateApiKey(value: unknown): string {
	if (typeof value !== 'string') invalid('apiKey must be a string')
	if (value.length > 4096) invalid('apiKey must contain at most 4096 characters')
	return value
}

export class AiSettingsStore {
	private settings: ChatSettings
	private readonly readOnly: boolean
	private readonly path: string
	private readonly persist: boolean
	private readonly aiEnabled: boolean
	private loadError = false

	constructor({
		path = AI_SETTINGS_PATH,
		config = loadAiConfig(),
		persist = true,
		aiEnabled = true,
	}: AiSettingsStoreOptions = {}) {
		this.path = path
		this.aiEnabled = aiEnabled
		this.readOnly = config.runtime === 'deploy' || !aiEnabled
		this.persist = persist && !this.readOnly
		this.settings = { ...config.chat }
		if (!this.persist) return
		try {
			const text = readFileSync(path, 'utf8')
			if (text.length === 0) {
				this.loadError = true
				return
			}
			const saved = JSON.parse(text) as unknown
			if (!isRecord(saved)) throw new Error('Invalid AI settings')
			const keys = Object.keys(saved)
			if (!keys.every((key) => key === 'baseURL' || key === 'model' || key === 'apiKey')) {
				throw new Error('Invalid AI settings')
			}
			if (typeof saved.baseURL !== 'string' || typeof saved.model !== 'string') {
				throw new Error('Invalid AI settings')
			}
			if (saved.apiKey !== undefined && typeof saved.apiKey !== 'string') {
				throw new Error('Invalid AI settings')
			}
			const baseURL = validateBaseURL(saved.baseURL)
			const model = validateModel(saved.model)
			const apiKey =
				saved.apiKey === undefined ? this.settings.apiKey : validateApiKey(saved.apiKey)
			this.settings = { baseURL, model, apiKey }
			try {
				chmodSync(path, 0o600)
			} catch {}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.loadError = true
		}
	}

	getPublic(): PublicAiSettings {
		if (this.loadError) {
			throw new OperationError(500, 'AI_SETTINGS_LOAD_FAILED', 'Could not load AI settings')
		}
		return {
			baseURL: this.settings.baseURL,
			model: this.settings.model,
			hasApiKey: this.settings.apiKey.length > 0,
			readOnly: this.readOnly,
		}
	}

	getEffective(): ChatSettings {
		if (this.loadError) {
			throw new OperationError(500, 'AI_SETTINGS_LOAD_FAILED', 'Could not load AI settings')
		}
		return { ...this.settings }
	}

	async update(body: unknown): Promise<PublicAiSettings> {
		if (this.readOnly) {
			throw new OperationError(
				this.aiEnabled ? 403 : 503,
				this.aiEnabled ? 'AI_SETTINGS_READ_ONLY' : 'AI_DISABLED',
				this.aiEnabled
					? 'AI settings are managed by the deployment environment'
					: 'AI features are disabled',
			)
		}
		if (!isRecord(body)) invalid('request must be an object')
		const keys = Object.keys(body)
		if (!keys.every((key) => key === 'baseURL' || key === 'model' || key === 'apiKey')) {
			invalid('invalid AI settings request')
		}
		if (typeof body.baseURL !== 'string' || typeof body.model !== 'string') {
			invalid('baseURL and model are required strings')
		}
		const baseURL = validateBaseURL(body.baseURL)
		const model = validateModel(body.model)
		const apiKey = body.apiKey === undefined ? this.settings.apiKey : validateApiKey(body.apiKey)
		const next = { baseURL, model, apiKey }

		if (this.persist) {
			try {
				await this.persistSettings(next)
			} catch {
				throw new OperationError(500, 'AI_SETTINGS_WRITE_FAILED', 'Could not persist AI settings')
			}
		}
		this.settings = next
		this.loadError = false
		return {
			baseURL: next.baseURL,
			model: next.model,
			hasApiKey: next.apiKey.length > 0,
			readOnly: this.readOnly,
		}
	}

	private async persistSettings(settings: ChatSettings): Promise<void> {
		const directory = dirname(this.path)
		await mkdir(directory, { recursive: true, mode: 0o700 })
		await chmod(directory, 0o700)
		const temporary = join(directory, `.settings-${process.pid}-${randomUUID()}.tmp`)
		let handle: Awaited<ReturnType<typeof open>> | undefined
		try {
			handle = await open(temporary, 'wx', 0o600)
			await handle.writeFile(JSON.stringify(settings), 'utf8')
			await handle.sync()
			await handle.close()
			handle = undefined
			await chmod(temporary, 0o600)
			await rename(temporary, this.path)
			await chmod(this.path, 0o600)
		} finally {
			if (handle) await handle.close().catch(() => {})
			await unlink(temporary).catch(() => {})
		}
	}
}
