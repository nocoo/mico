import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
	DEFAULT_CHAT_BASE_URL,
	DEFAULT_CHAT_MODEL,
	DEFAULT_IMAGE_MODEL,
	DEFAULT_MOSS_URL,
	loadAiConfig,
	loadImageConfig,
	loadRuntimeEnv,
} from './aiConfig.ts'

test('local startup loads .env below process values while deploy never reads it', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-env-'))
	const path = join(directory, '.env')
	try {
		writeFileSync(
			path,
			'MAGPIE_BASE_URL=http://127.0.0.1:3425/v1\nMAGPIE_API_KEY=file-key\nMOSS_API_KEY=file-voice-key\n',
		)
		assert.deepEqual(loadRuntimeEnv({ MAGPIE_API_KEY: '' }, path), {
			MAGPIE_BASE_URL: 'http://127.0.0.1:3425/v1',
			MAGPIE_API_KEY: '',
			MOSS_API_KEY: 'file-voice-key',
		})
		const deploy = {
			MICO_RUNTIME: 'deploy',
			MAGPIE_BASE_URL: 'https://cloud.example/v1',
			MAGPIE_MODEL: 'cloud',
		}
		assert.deepEqual(loadRuntimeEnv(deploy, path), deploy)
		assert.deepEqual(loadRuntimeEnv(deploy, directory), deploy)
		assert.deepEqual(loadRuntimeEnv({}, join(directory, 'missing')), {})
		assert.throws(() => loadRuntimeEnv({}, directory), /Could not read local environment file/)
		writeFileSync(path, 'MICO_RUNTIME=deploy\nMAGPIE_API_KEY=file-key\n')
		assert.throws(() => loadRuntimeEnv({}, path), /must be set in the process environment/)
		assert.equal(loadRuntimeEnv({ MICO_RUNTIME: 'laptop' }, path).MICO_RUNTIME, 'laptop')
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('laptop and local production builds keep the existing provider defaults', () => {
	const config = loadAiConfig({})
	assert.equal(config.runtime, 'laptop')
	assert.deepEqual(config.chat, {
		baseURL: DEFAULT_CHAT_BASE_URL,
		model: DEFAULT_CHAT_MODEL,
		apiKey: 'magpie',
		authMode: 'api-key',
	})
	assert.deepEqual(config.mai, { host: '', apiKey: '', deployment: '' })
	assert.deepEqual(config.image, { endpoint: '', apiKey: '', model: DEFAULT_IMAGE_MODEL })
	assert.deepEqual(config.moss, { url: DEFAULT_MOSS_URL, apiKey: '' })
	assert.equal(config.lectureReasoning, 'none')
	assert.deepEqual(loadAiConfig({ NODE_ENV: 'production' }), config)
	assert.equal(loadAiConfig({ MAGPIE_API_KEY: '' }).chat.apiKey, '')
})

test('deploy requires an explicit chat endpoint and model without a default credential', () => {
	for (const env of [
		{},
		{ MAGPIE_BASE_URL: 'https://gateway.example/v1' },
		{ MAGPIE_MODEL: 'cloud-model' },
		{ MAGPIE_BASE_URL: ' ', MAGPIE_MODEL: 'cloud-model' },
	]) {
		assert.throws(
			() => loadAiConfig({ ...env, MICO_RUNTIME: 'deploy' }),
			/MAGPIE_BASE_URL and MAGPIE_MODEL are required/,
		)
	}
	const config = loadAiConfig({
		MICO_RUNTIME: 'deploy',
		MAGPIE_BASE_URL: 'https://gateway.example/v1/',
		MAGPIE_MODEL: 'cloud-model',
	})
	assert.equal(config.runtime, 'deploy')
	assert.deepEqual(config.chat, {
		baseURL: 'https://gateway.example/v1',
		model: 'cloud-model',
		apiKey: '',
		authMode: 'api-key',
	})
})

test('one environment snapshot configures all four AI paths', () => {
	const env = Object.freeze({
		MICO_RUNTIME: 'deploy',
		MAGPIE_BASE_URL: ' https://gateway.example/prefix/v1/ ',
		MAGPIE_MODEL: ' cloud-chat ',
		MAGPIE_API_KEY: 'chat-test-secret',
		MAGPIE_LECTURE_REASONING: 'medium',
		AZURE_MAI_HOST: 'resource.services.ai.azure.com',
		AZURE_OPENAI_DEPLOYMENT: 'custom-transcription',
		AZURE_OPENAI_ENDPOINT: 'https://resource.openai.azure.com/openai/v1/',
		AZURE_OPENAI_API_KEY: 'azure-test-secret',
		AZURE_OPENAI_IMAGE_MODEL: 'custom-image',
		MOSS_REALTIME_URL: 'wss://voice.example/realtime?model=custom-voice',
		MOSS_API_KEY: 'voice-test-secret',
	})
	assert.deepEqual(loadAiConfig(env), {
		runtime: 'deploy',
		authMode: 'api-key',
		azureClientId: undefined,
		chat: {
			baseURL: 'https://gateway.example/prefix/v1',
			model: 'cloud-chat',
			apiKey: 'chat-test-secret',
			authMode: 'api-key',
		},
		lectureReasoning: 'medium',
		mai: {
			host: 'resource.services.ai.azure.com',
			apiKey: 'azure-test-secret',
			deployment: 'custom-transcription',
		},
		image: {
			endpoint: 'https://resource.openai.azure.com/openai/v1',
			apiKey: 'azure-test-secret',
			model: 'custom-image',
		},
		moss: { url: 'wss://voice.example/realtime?model=custom-voice', apiKey: 'voice-test-secret' },
	})
})

test('managed identity uses Azure hosts and removes provider keys', () => {
	const config = loadAiConfig({
		MICO_RUNTIME: 'laptop',
		MICO_AI_AUTH_MODE: 'managed-identity',
		AZURE_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
		MAGPIE_BASE_URL: 'https://resource.services.ai.azure.com/openai/v1',
		MAGPIE_MODEL: 'chat-deployment',
		MAGPIE_API_KEY: 'must-not-leak',
		AZURE_MAI_HOST: 'resource.services.ai.azure.com',
		AZURE_OPENAI_DEPLOYMENT: 'voice-deployment',
		AZURE_OPENAI_API_KEY: 'must-not-leak-mai',
	})
	assert.equal(config.authMode, 'managed-identity')
	assert.equal(config.chat.authMode, 'managed-identity')
	assert.equal(config.chat.apiKey, '')
	assert.equal(config.mai.apiKey, '')
	assert.equal(config.mai.host, 'resource.services.ai.azure.com')
	assert.equal(config.mai.deployment, 'voice-deployment')

	assert.throws(
		() =>
			loadAiConfig({
				MICO_AI_AUTH_MODE: 'managed-identity',
				AZURE_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
				MAGPIE_BASE_URL: 'http://resource.services.ai.azure.com/openai/v1',
				MAGPIE_MODEL: 'chat-deployment',
			}),
		/MAGPIE_BASE_URL must use an allowed Azure AI HTTPS resource host/,
	)
	assert.throws(
		() =>
			loadAiConfig({
				MICO_AI_AUTH_MODE: 'managed-identity',
				AZURE_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
				MAGPIE_BASE_URL: 'https://resource.example/openai/v1',
				MAGPIE_MODEL: 'chat-deployment',
			}),
		/MAGPIE_BASE_URL must use an allowed Azure AI HTTPS resource host/,
	)
	assert.throws(
		() =>
			loadAiConfig({
				MICO_AI_AUTH_MODE: 'managed-identity',
				AZURE_CLIENT_ID: 'not-a-guid',
				MAGPIE_BASE_URL: 'https://resource.services.ai.azure.com/openai/v1',
				MAGPIE_MODEL: 'chat-deployment',
			}),
		/AZURE_CLIENT_ID must be a GUID/,
	)
})

test('managed identity requires explicit identity and deployment settings', () => {
	assert.throws(
		() => loadAiConfig({ MICO_AI_AUTH_MODE: 'managed-identity' }),
		/AZURE_CLIENT_ID is required/,
	)
	assert.throws(
		() => loadAiConfig({ MICO_AI_AUTH_MODE: 'managed-identity', AZURE_CLIENT_ID: 'invalid' }),
		/AZURE_CLIENT_ID must be a GUID/,
	)
	assert.throws(
		() =>
			loadAiConfig({
				MICO_AI_AUTH_MODE: 'managed-identity',
				AZURE_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
			}),
		/MAGPIE_BASE_URL and MAGPIE_MODEL are required/,
	)
	assert.throws(
		() =>
			loadAiConfig({
				MICO_AI_AUTH_MODE: 'managed-identity',
				AZURE_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
				MAGPIE_BASE_URL: 'https://resource.services.ai.azure.com/openai/v1',
				MAGPIE_MODEL: 'chat',
				AZURE_MAI_HOST: 'resource.services.ai.azure.com:8443',
			}),
		/Azure AI HTTPS/,
	)
	assert.deepEqual(
		loadAiConfig({
			MICO_MOSS_ENABLED: 'false',
			MOSS_REALTIME_URL: 'invalid',
			MOSS_API_KEY: 'invalid\r\n',
		}).moss,
		{ url: '', apiKey: '' },
	)
})

test('invalid configuration fails without including credential-bearing values', () => {
	for (const [name, value] of [
		['MICO_RUNTIME', 'unknown'],
		['MAGPIE_BASE_URL', 'https://user:private-value@gateway.example/v1'],
		['MAGPIE_BASE_URL', 'https://gateway.example/v1?token=private-value'],
		['MAGPIE_BASE_URL', 'file:///private-value'],
		['AZURE_OPENAI_ENDPOINT', '/private-value'],
		['AZURE_MAI_HOST', 'resource.example/path'],
		['AZURE_MAI_HOST', 'https://resource.example'],
		['MOSS_REALTIME_URL', 'http://voice.example'],
		['MAGPIE_API_KEY', 'private-value\r\nAuthorization: other'],
		['AZURE_OPENAI_API_KEY', 'private-value\n'],
		['MOSS_API_KEY', 'private-value\r'],
	]) {
		assert.throws(
			() => loadAiConfig({ [name]: value }),
			(error: unknown) => {
				assert.ok(error instanceof Error)
				assert.match(error.message, new RegExp(name))
				assert.equal(error.message.includes('private-value'), false)
				return true
			},
		)
	}
})

test('the standalone image script needs only its own environment configuration', () => {
	assert.deepEqual(
		loadImageConfig({
			MICO_RUNTIME: 'deploy',
			AZURE_OPENAI_ENDPOINT: 'https://images.example/prefix/v1/',
			AZURE_OPENAI_API_KEY: 'image-test-secret',
			AZURE_OPENAI_IMAGE_MODEL: 'image-deployment',
		}),
		{
			endpoint: 'https://images.example/prefix/v1',
			apiKey: 'image-test-secret',
			model: 'image-deployment',
		},
	)
	assert.equal(
		loadImageConfig({ AZURE_OPENAI_ENDPOINT: 'https://resource.openai.azure.com/' }).endpoint,
		'https://resource.openai.azure.com',
	)
})
