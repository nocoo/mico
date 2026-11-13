import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import WebSocket from 'ws'
import { DOCKER_PORT } from '../src/shared/config.ts'
import type { Board, CanvasSnapshot } from '../src/shared/types.ts'

const url = `http://127.0.0.1:${DOCKER_PORT}`
const project = `mico-smoke-${randomUUID().slice(0, 8)}`
const artifacts = mkdtempSync(join(tmpdir(), 'mico-docker-smoke-'))
const envFile = join(artifacts, 'empty.env')
writeFileSync(envFile, '')
const env = {
	...process.env,
	MICO_DOCKER_MAGPIE_BASE_URL: 'http://127.0.0.1:9/v1',
	MAGPIE_API_KEY: '',
	AZURE_MAI_HOST: '',
	AZURE_OPENAI_API_KEY: '',
	AZURE_OPENAI_ENDPOINT: '',
	AZURE_OPENAI_DEPLOYMENT: '',
	MOSS_API_KEY: '',
}

function compose(...args: string[]): string {
	const result = spawnSync('docker', ['compose', '--env-file', envFile, '-p', project, ...args], {
		encoding: 'utf8',
		timeout: 180_000,
		env,
	})
	assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`)
	return result.stdout
}

async function json(path: string, method = 'GET', body?: unknown) {
	const response = await fetch(`${url}${path}`, {
		method,
		headers: { Origin: url, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(10_000),
	})
	assert.equal(response.status, 200, `${method} ${path}`)
	return response.json()
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
	compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '90')
	assert.equal((await json('/api/live')).status, 'ok')
	const state = (await json('/api/state')) as CanvasSnapshot
	assert.equal(state.canvases.length, 1)
	assert.equal(state.board.shapes.length, 0)

	browser = await chromium.launch({ channel: 'chrome', headless: true })
	const page = await browser.newPage({
		viewport: { width: 1440, height: 1000 },
		reducedMotion: 'reduce',
	})
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('requestfailed', (request) => errors.push(`Failed request: ${request.url()}`))
	page.on('response', (response) => {
		if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
	})
	await page.goto(url)
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible()
	await expect(page.getByRole('combobox', { name: 'Recording', exact: true })).toBeEnabled()
	await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Sticky note', exact: true }).click()
	await page.mouse.click(600, 450)
	await expect.poll(async () => ((await json('/api/board')) as Board).shapes.length).toBe(1)
	const note = ((await json('/api/board')) as Board).shapes[0]

	const socket = new WebSocket(`${url.replace('http:', 'ws:')}/api/events`, { origin: url })
	try {
		const [snapshot] = await once(socket, 'message', { signal: AbortSignal.timeout(5000) })
		assert.equal(JSON.parse(snapshot.toString()).type, 'snapshot')
		const update = once(socket, 'message', { signal: AbortSignal.timeout(5000) })
		await json('/api/operations', 'POST', {
			operations: [{ type: 'update', id: note.id, patch: { text: 'Docker persistence verified' } }],
		})
		const [message] = await update
		assert.equal(JSON.parse(message.toString()).type, 'board')
		await expect(page.locator(`[data-shape-id="${note.id}"]`)).toContainText(
			'Docker persistence verified',
		)
	} finally {
		socket.terminate()
	}

	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=',
		'base64',
	)
	const upload = await fetch(`${url}/api/images`, {
		method: 'POST',
		headers: { Origin: url, 'Content-Type': 'image/png' },
		body: png,
	})
	assert.equal(upload.status, 200)
	const image = (await upload.json()) as { id: string }
	const settings = { baseURL: 'http://127.0.0.1:9/v1', model: 'docker-smoke', apiKey: randomUUID() }
	const saved = await json('/api/ai/settings', 'PUT', settings)
	assert.equal(saved.hasApiKey, true)
	assert.equal('apiKey' in saved, false)
	const audio = await fetch(`${url}/evals/audio/c01-family-trip.mp3`, {
		headers: { Range: 'bytes=0-31' },
	})
	assert.equal(audio.status, 206)
	assert.equal((await audio.arrayBuffer()).byteLength, 32)
	for (const path of ['/.env', '/package.json', '/src/server/index.ts', '/api/missing']) {
		assert.equal((await fetch(`${url}${path}`)).status, 404, path)
	}
	assert.equal(
		(await fetch(`${url}/api/state`, { headers: { Origin: 'https://evil.example' } })).status,
		403,
	)
	assert.equal((await json('/mai/config')).localPath, '/mai/realtime')
	for (const path of ['/moss', '/mai/realtime']) {
		const provider = new WebSocket(`${url.replace('http:', 'ws:')}${path}`, { origin: url })
		try {
			const [code] = await once(provider, 'close', { signal: AbortSignal.timeout(5000) })
			assert.equal(code, 1008)
		} finally {
			provider.terminate()
		}
	}
	assert.equal(errors.length, 0, errors.join('\n'))
	await page.screenshot({
		path: join(artifacts, 'before-recreate.png'),
		fullPage: true,
		animations: 'disabled',
	})
	await browser.close()
	browser = undefined

	compose('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '90')
	const restored = (await json('/api/board')) as Board
	assert.equal(restored.shapes[0].id, note.id)
	assert.equal((restored.shapes[0] as { text?: string }).text, 'Docker persistence verified')
	assert.deepEqual(await json('/api/ai/settings'), saved)
	assert.deepEqual(
		Buffer.from(await (await fetch(`${url}/api/images/${image.id}`)).arrayBuffer()),
		png,
	)
	assert.match(
		compose('exec', '-T', 'mico', 'node', 'src/cli/index.ts', 'board', 'get'),
		/Docker persistence verified/,
	)
	assert.equal(compose('exec', '-T', 'mico', 'id', '-u').trim(), '1000')
	compose(
		'exec',
		'-T',
		'mico',
		'node',
		'-e',
		"const fs=require('node:fs'); if(fs.existsSync('/app/.env')||fs.existsSync('/app/node_modules/vite')) process.exit(1); if((fs.statSync('/home/node/.config/mico/settings.json').mode&511)!==384) process.exit(1)",
	)

	browser = await chromium.launch({ channel: 'chrome', headless: true })
	const reloaded = await browser.newPage({
		viewport: { width: 1440, height: 1000 },
		reducedMotion: 'reduce',
	})
	reloaded.on('pageerror', (error) => errors.push(error.message))
	reloaded.on('requestfailed', (request) => errors.push(`Failed request: ${request.url()}`))
	reloaded.on('response', (response) => {
		if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
	})
	await reloaded.goto(url)
	await expect(reloaded.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await expect(reloaded.getByRole('combobox', { name: 'Recording', exact: true })).toBeEnabled()
	await expect(reloaded.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible()
	await expect(reloaded.locator(`[data-shape-id="${note.id}"]`)).toContainText(
		'Docker persistence verified',
	)
	await reloaded.screenshot({
		path: join(artifacts, 'after-recreate.png'),
		fullPage: true,
		animations: 'disabled',
	})
	assert.deepEqual(errors, [])
	console.log(`Docker smoke passed. Screenshots: ${artifacts}`)
} finally {
	await browser?.close()
	writeFileSync(join(artifacts, 'container.log'), compose('logs', '--no-color'))
	compose('down', '--volumes')
}
