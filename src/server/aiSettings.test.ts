import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
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
			env: {
				MAGPIE_BASE_URL: 'https://env.example/v1/',
				MAGPIE_MODEL: 'env-model',
				MAGPIE_API_KEY: 'env-secret',
			},
		})
		assert.deepEqual(store.getEffective(), {
			baseURL: 'https://saved.example/v1',
			model: 'saved-model',
			apiKey: 'saved-secret',
		})
		assert.deepEqual(store.getPublic(), {
			baseURL: 'https://saved.example/v1',
			model: 'saved-model',
			hasApiKey: true,
		})
		assert.equal(statSync(settingsPath).mode & 0o777, 0o600)

		await store.update({ baseURL: 'https://next.example/v2/', model: 'next-model' })
		assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).apiKey, 'saved-secret')
		assert.equal(statSync(settingsPath).mode & 0o777, 0o600)
		assert.equal(statSync(join(directory, 'mico')).mode & 0o777, 0o700)

		await store.update({ baseURL: 'https://next.example/v2', model: 'next-model', apiKey: '' })
		const cleared = new AiSettingsStore({ path: settingsPath, env: {} })
		assert.equal(cleared.getEffective().apiKey, '')
		assert.equal(cleared.getPublic().hasApiKey, false)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('corrupt settings block chat fallback and persist-false mode never reads disk', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-settings-corrupt-'))
	const settingsPath = join(directory, 'settings.json')
	try {
		writeFileSync(settingsPath, '{broken', { mode: 0o600 })
		const corrupt = new AiSettingsStore({ path: settingsPath })
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
			env: { MAGPIE_API_KEY: '' },
			persist: false,
		})
		assert.equal(memoryOnly.getPublic().hasApiKey, false)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
