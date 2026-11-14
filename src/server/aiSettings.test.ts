import assert from 'node:assert/strict'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadAiConfig } from './aiConfig.ts'
import { AiSettingsStore } from './aiSettings.ts'

test('AI settings use environment defaults, saved-file precedence, and atomic file modes', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-settings-'))
	const settingsPath = join(directory, 'mico', 'settings.json')
	try {
		mkdirSync(join(directory, 'mico'))
		writeFileSync(
			settingsPath,
			JSON.stringify({
				baseURL: 'https://saved.example/v1/',
				model: 'saved-model',
				apiKey: 'saved-secret',
			}),
			{ mode: 0o644 },
		)

		const store = new AiSettingsStore({
			path: settingsPath,
			config: loadAiConfig({
				MAGPIE_BASE_URL: 'https://env.example/v1/',
				MAGPIE_MODEL: 'env-model',
				MAGPIE_API_KEY: 'env-secret',
			}),
		})
		assert.deepEqual(store.getEffective(), {
			baseURL: 'https://saved.example/v1',
			model: 'saved-model',
			apiKey: 'saved-secret',
			authMode: 'api-key',
		})
		assert.deepEqual(store.getPublic(), {
			baseURL: 'https://saved.example/v1',
			model: 'saved-model',
			hasApiKey: true,
			authMode: 'api-key',
			readOnly: false,
		})
		assert.equal(statSync(settingsPath).mode & 0o777, 0o600)

		await store.update({ baseURL: 'https://next.example/v2/', model: 'next-model' })
		assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).apiKey, 'saved-secret')
		assert.equal(statSync(settingsPath).mode & 0o777, 0o600)
		assert.equal(statSync(join(directory, 'mico')).mode & 0o777, 0o700)

		await store.update({ baseURL: 'https://next.example/v2', model: 'next-model', apiKey: '' })
		const cleared = new AiSettingsStore({ path: settingsPath, config: loadAiConfig({}) })
		assert.equal(cleared.getEffective().apiKey, '')
		assert.equal(cleared.getPublic().hasApiKey, false)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('deploy ignores saved credentials and refuses all settings writes without touching disk', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-deploy-'))
	const config = loadAiConfig({
		MICO_RUNTIME: 'deploy',
		MAGPIE_BASE_URL: 'https://cloud.example/v1',
		MAGPIE_MODEL: 'cloud-model',
		MAGPIE_API_KEY: 'cloud-secret',
	})
	try {
		for (const content of [
			undefined,
			'{broken',
			JSON.stringify({
				baseURL: 'https://old.example/v1',
				model: 'old-model',
				apiKey: 'old-secret',
			}),
		]) {
			const path = join(directory, 'settings.json')
			if (content !== undefined) writeFileSync(path, content, { mode: 0o644 })
			for (const persist of [true, false]) {
				const store = new AiSettingsStore({ path, config, persist })
				assert.deepEqual(store.getEffective(), config.chat)
				assert.deepEqual(store.getPublic(), {
					baseURL: 'https://cloud.example/v1',
					model: 'cloud-model',
					hasApiKey: true,
					authMode: 'api-key',
					readOnly: true,
				})
				assert.equal(JSON.stringify(store.getPublic()).includes('cloud-secret'), false)
				await assert.rejects(
					store.update({
						baseURL: 'https://other.example/v1',
						model: 'other',
						apiKey: 'other-secret',
					}),
					{ code: 'AI_SETTINGS_READ_ONLY', status: 403 },
				)
				assert.deepEqual(store.getEffective(), config.chat)
				if (content === undefined) assert.equal(existsSync(path), false)
				else {
					assert.equal(readFileSync(path, 'utf8'), content)
					assert.equal(statSync(path).mode & 0o777, 0o644)
				}
			}
		}
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('managed identity settings are readonly and ignore saved provider credentials', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-managed-'))
	const settingsPath = join(directory, 'settings.json')
	writeFileSync(
		settingsPath,
		JSON.stringify({
			baseURL: 'https://saved.example/v1',
			model: 'saved-model',
			apiKey: 'saved-secret',
		}),
		{ mode: 0o600 },
	)
	try {
		const store = new AiSettingsStore({
			path: settingsPath,
			config: loadAiConfig({
				MICO_RUNTIME: 'laptop',
				MICO_AI_AUTH_MODE: 'managed-identity',
				AZURE_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
				MAGPIE_BASE_URL: 'https://resource.services.ai.azure.com/openai/v1',
				MAGPIE_MODEL: 'managed-model',
				MAGPIE_API_KEY: 'environment-secret',
			}),
		})
		assert.deepEqual(store.getEffective(), {
			baseURL: 'https://resource.services.ai.azure.com/openai/v1',
			model: 'managed-model',
			apiKey: '',
			authMode: 'managed-identity',
		})
		assert.deepEqual(store.getPublic(), {
			baseURL: 'https://resource.services.ai.azure.com/openai/v1',
			model: 'managed-model',
			hasApiKey: false,
			authMode: 'managed-identity',
			readOnly: true,
		})
		assert.equal(JSON.stringify(store.getPublic()).includes('saved-secret'), false)
		assert.equal(JSON.stringify(store.getPublic()).includes('environment-secret'), false)
		await assert.rejects(store.update({ baseURL: 'https://other.example/v1', model: 'other' }), {
			code: 'AI_SETTINGS_READ_ONLY',
			status: 403,
		})
		assert.equal(readFileSync(settingsPath, 'utf8').includes('saved-secret'), true)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('corrupt settings block chat fallback and persist-false mode never reads disk', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-settings-corrupt-'))
	const settingsPath = join(directory, 'settings.json')
	try {
		writeFileSync(settingsPath, '{broken', { mode: 0o600 })
		const corrupt = new AiSettingsStore({ path: settingsPath, config: loadAiConfig({}) })
		assert.throws(
			() => corrupt.getPublic(),
			(error: unknown) => {
				return (
					typeof error === 'object' &&
					error !== null &&
					'code' in error &&
					(error as { code: string }).code === 'AI_SETTINGS_LOAD_FAILED'
				)
			},
		)
		assert.throws(
			() => corrupt.getEffective(),
			(error: unknown) => {
				return (
					typeof error === 'object' &&
					error !== null &&
					'code' in error &&
					(error as { code: string }).code === 'AI_SETTINGS_LOAD_FAILED'
				)
			},
		)

		await corrupt.update({
			baseURL: 'https://recovered.example/v1',
			model: 'recovered-model',
			apiKey: '',
		})
		assert.equal(corrupt.getEffective().model, 'recovered-model')

		const memoryOnly = new AiSettingsStore({
			path: settingsPath,
			config: loadAiConfig({ MAGPIE_API_KEY: '' }),
			persist: false,
		})
		assert.equal(memoryOnly.getPublic().hasApiKey, false)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
