import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ChatSettings } from './aiConfig.ts'
import { createMockAiModel } from './aiMock.ts'
import { createDaemon, type Daemon } from './index.ts'

test('deploy entrypoint cannot fill missing cloud settings from a local .env', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-deploy-entry-'))
	try {
		writeFileSync(
			join(directory, '.env'),
			'MAGPIE_BASE_URL=https://file.example/v1\nMAGPIE_MODEL=file-model\nMAGPIE_API_KEY=file-secret\n',
		)
		const dbPath = join(directory, 'board.sqlite')
		const result = spawnSync(
			process.execPath,
			[fileURLToPath(new URL('./index.ts', import.meta.url))],
			{
				cwd: directory,
				env: { HOME: directory, MICO_RUNTIME: 'deploy', MICO_DB_PATH: dbPath },
				encoding: 'utf8',
				timeout: 5000,
			},
		)
		assert.equal(result.status, 1)
		assert.match(result.stderr, /MAGPIE_BASE_URL and MAGPIE_MODEL are required/)
		assert.doesNotMatch(result.stderr, /file-secret/)
		assert.equal(existsSync(dbPath), false)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('Vite disables implicit env files in deploy mode and rejects file-driven runtime switching', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-vite-env-'))
	const configFile = fileURLToPath(new URL('../../vite.config.ts', import.meta.url))
	const source = `import { resolveConfig } from ${JSON.stringify(import.meta.resolve('vite'))};
const config = await resolveConfig({ configFile: ${JSON.stringify(configFile)}, configLoader: 'native', root: process.cwd(), logLevel: 'silent' }, 'serve');
console.log(JSON.stringify({ envDir: config.envDir, marker: config.env.VITE_LOCAL_MARKER }));`
	const run = (env: NodeJS.ProcessEnv) =>
		spawnSync(process.execPath, ['--input-type=module', '-e', source], {
			cwd: directory,
			env: { HOME: directory, ...env },
			encoding: 'utf8',
			timeout: 10_000,
		})
	try {
		writeFileSync(
			join(directory, '.env'),
			'VITE_LOCAL_MARKER=from-local-file\nMAGPIE_API_KEY=file-test-key\n',
		)
		const deploy = run({
			MICO_RUNTIME: 'deploy',
			MAGPIE_BASE_URL: 'https://cloud.example/v1',
			MAGPIE_MODEL: 'cloud',
		})
		assert.equal(deploy.status, 0, deploy.stderr)
		assert.deepEqual(JSON.parse(deploy.stdout), { envDir: false })
		const local = run({ MICO_RUNTIME: 'laptop' })
		assert.equal(local.status, 0, local.stderr)
		assert.equal(JSON.parse(local.stdout).marker, 'from-local-file')
		writeFileSync(
			join(directory, '.env'),
			'MICO_RUNTIME=deploy\nMAGPIE_BASE_URL=https://file.example/v1\nMAGPIE_MODEL=file-model\n',
		)
		const switched = run({})
		assert.equal(switched.status, 1)
		assert.match(switched.stderr, /must be set in the process environment/)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('deploy HTTP routes use environment credentials and reject browser configuration changes', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ai-config-http-'))
	const observed: { path?: string; authorization?: string }[] = []
	const gateway = createServer((req, res) => {
		observed.push({ path: req.url, authorization: req.headers.authorization })
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ data: [{ id: 'cloud-chat' }] }))
	})
	gateway.listen(0, '127.0.0.1')
	await once(gateway, 'listening')
	const address = gateway.address()
	assert.ok(address && typeof address !== 'string')
	const baseURL = `http://127.0.0.1:${address.port}/prefix/v1`
	const settingsPath = join(directory, 'settings.json')
	const saved = JSON.stringify({
		baseURL: 'https://stale.example/v1',
		model: 'stale-model',
		apiKey: 'stale-secret',
	})
	writeFileSync(settingsPath, saved)
	const staticDir = join(directory, 'dist')
	mkdirSync(staticDir)
	writeFileSync(join(staticDir, 'index.html'), '<title>Mico</title>')
	const model = createMockAiModel()
	let received: ChatSettings | undefined
	let daemon: Daemon | undefined
	try {
		daemon = createDaemon({
			port: 0,
			dbPath: join(directory, 'board.sqlite'),
			settingsPath,
			staticDir,
			env: {
				MICO_RUNTIME: 'deploy',
				MAGPIE_BASE_URL: baseURL,
				MAGPIE_MODEL: 'cloud-chat',
				MAGPIE_API_KEY: 'cloud-chat-secret',
				MAGPIE_LECTURE_REASONING: 'medium',
				AZURE_MAI_HOST: 'transcription.example',
				AZURE_OPENAI_DEPLOYMENT: 'cloud-transcription',
				AZURE_OPENAI_API_KEY: 'cloud-azure-secret',
				MOSS_API_KEY: 'cloud-moss-secret',
			},
			createAiModel(settings) {
				received = settings
				return model
			},
		})
		daemon.server.listen(0, '127.0.0.1')
		await once(daemon.server, 'listening')
		const serverAddress = daemon.server.address()
		assert.ok(serverAddress && typeof serverAddress !== 'string')
		const url = `http://127.0.0.1:${serverAddress.port}`
		const settings = await fetch(`${url}/api/ai/settings`)
		assert.equal(settings.status, 200)
		assert.deepEqual(await settings.json(), {
			baseURL,
			model: 'cloud-chat',
			hasApiKey: true,
			authMode: 'api-key',
			readOnly: true,
		})
		const changed = await fetch(`${url}/api/ai/settings`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				baseURL: 'https://other.example/v1',
				model: 'other',
				apiKey: 'other-secret',
			}),
		})
		assert.equal(changed.status, 403)
		assert.equal((await changed.json()).error, 'AI_SETTINGS_READ_ONLY')
		assert.equal(readFileSync(settingsPath, 'utf8'), saved)
		const models = await fetch(`${url}/api/ai/models`)
		assert.equal(models.status, 200)
		assert.deepEqual(await models.json(), { models: ['cloud-chat'] })
		assert.deepEqual(observed, [
			{ path: '/prefix/v1/models', authorization: 'Bearer cloud-chat-secret' },
		])
		const mai = await fetch(`${url}/mai/config`)
		assert.deepEqual(await mai.json(), {
			host: 'transcription.example',
			deployment: 'cloud-transcription',
			localPath: '/mai/realtime',
		})
		const chat = await fetch(`${url}/api/ai/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				mode: 'lecture',
				messages: [{ id: 'turn', role: 'user', parts: [{ type: 'text', text: 'Draw a lesson' }] }],
			}),
		})
		assert.equal(chat.status, 200)
		const text = await chat.text()
		assert.doesNotMatch(text, /cloud-chat-secret|cloud-azure-secret|cloud-moss-secret|stale-secret/)
		assert.deepEqual(received, {
			baseURL,
			model: 'cloud-chat',
			apiKey: 'cloud-chat-secret',
			authMode: 'api-key',
		})
		assert.deepEqual(model.doStreamCalls[0]?.providerOptions, {
			magpie: { reasoningEffort: 'medium' },
		})
		assert.equal(readFileSync(settingsPath, 'utf8'), saved)
	} finally {
		await daemon?.close()
		await new Promise<void>((resolve) => gateway.close(() => resolve()))
		rmSync(directory, { recursive: true, force: true })
	}
})
