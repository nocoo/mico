import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import WebSocket from 'ws'
import { DOCKER_PORT } from '../src/shared/config.ts'
import type { Board, CanvasSnapshot } from '../src/shared/types.ts'

const project = `mico-csmoke-${randomUUID().slice(0, 8)}`
const image = `${project}:local`
const dataVolume = `${project}-data`
const settingsVolume = `${project}-settings`
const artifacts = mkdtempSync(join(tmpdir(), 'mico-container-smoke-'))
let containerName = `${project}-1`
let activeIp = ''

function container(args: string[], allowFailure = false): string {
	const result = spawnSync('container', args, {
		encoding: 'utf8',
		timeout: 300_000,
	})
	if (!allowFailure) {
		assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`)
	}
	return result.stdout ?? ''
}

function getContainerIp(name: string): string {
	const out = container(['ls'])
	for (const line of out.split('\n')) {
		const cols = line.trim().split(/\s+/)
		if (cols[0] === name && cols[5]) {
			return cols[5].split('/')[0] ?? ''
		}
	}
	return ''
}

const proxy = createServer((client) => {
	if (!activeIp) {
		client.destroy()
		return
	}
	const upstream = createConnection({ host: activeIp, port: 47063 })
	client.pipe(upstream)
	upstream.pipe(client)
	client.on('error', () => upstream.destroy())
	upstream.on('error', () => client.destroy())
})

await new Promise<void>((resolve) => proxy.listen(DOCKER_PORT, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${DOCKER_PORT}`

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

function startMicoContainer(name: string): void {
	container([
		'run',
		'-d',
		'--name',
		name,
		'--platform',
		'linux/amd64',
		'--init',
		'--read-only',
		'--tmpfs',
		'/tmp',
		'--cap-drop',
		'ALL',
		'-v',
		`${dataVolume}:/data`,
		'-v',
		`${settingsVolume}:/home/node/.config/mico`,
		'-e',
		'MICO_RUNTIME=laptop',
		'-e',
		'MAGPIE_BASE_URL=http://127.0.0.1:9/v1',
		'-e',
		'MAGPIE_API_KEY=',
		'-e',
		'AZURE_MAI_HOST=',
		'-e',
		'AZURE_OPENAI_API_KEY=',
		'-e',
		'AZURE_OPENAI_ENDPOINT=',
		'-e',
		'AZURE_OPENAI_DEPLOYMENT=',
		'-e',
		'MOSS_API_KEY=',
		image,
	])
	activeIp = getContainerIp(name)
	assert.ok(activeIp, `Expected VM IP for container ${name}`)
}

async function waitHealthy(): Promise<void> {
	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${url}/api/live`, { signal: AbortSignal.timeout(2000) })
			if (res.ok) return
		} catch {
			// retry until deadline
		}
		await new Promise((r) => setTimeout(r, 500))
	}
	throw new Error('Container did not become healthy within 60s')
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const buildDir = mkdtempSync(join(tmpdir(), 'mico-container-build-'))
try {
	const archive = join(buildDir, 'source.tar')
	const archiveRes = spawnSync('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD'], {
		encoding: 'utf8',
	})
	assert.equal(archiveRes.status, 0, archiveRes.stderr)
	const untarRes = spawnSync('tar', ['-xf', archive, '-C', buildDir], { encoding: 'utf8' })
	assert.equal(untarRes.status, 0, untarRes.stderr)
	rmSync(archive)

	const npmRegistry = process.env.NPM_REGISTRY || 'https://packagefeedproxy.microsoft.io/npm/'
	const dns = process.env.MICO_CONTAINER_DNS?.trim()
	container([
		'build',
		'--platform',
		'linux/amd64',
		'--build-arg',
		`NPM_REGISTRY=${npmRegistry}`,
		...(dns ? ['--dns', dns] : []),
		'-t',
		image,
		buildDir,
	])

	container(['volume', 'create', dataVolume])
	container(['volume', 'create', settingsVolume])
	container([
		'run',
		'--rm',
		'--platform',
		'linux/amd64',
		'-u',
		'0',
		'-v',
		`${dataVolume}:/data`,
		'-v',
		`${settingsVolume}:/home/node/.config/mico`,
		'--entrypoint',
		'chown',
		image,
		'-R',
		'1000:1000',
		'/data',
		'/home/node/.config/mico',
	])
	startMicoContainer(containerName)
	await waitHealthy()

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
			operations: [
				{ type: 'update', id: note.id, patch: { text: 'Container persistence verified' } },
			],
		})
		const [message] = await update
		assert.equal(JSON.parse(message.toString()).type, 'board')
		await expect(page.locator(`[data-shape-id="${note.id}"]`)).toContainText(
			'Container persistence verified',
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
	const uploaded = (await upload.json()) as { id: string }
	const settings = {
		baseURL: 'http://127.0.0.1:9/v1',
		model: 'container-smoke',
		apiKey: randomUUID(),
	}
	const saved = await json('/api/ai/settings', 'PUT', settings)
	assert.equal(saved.hasApiKey, true)
	assert.equal('apiKey' in saved, false)
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

	container(['stop', containerName])
	container(['rm', containerName])
	containerName = `${project}-2`
	startMicoContainer(containerName)
	await waitHealthy()

	const restored = (await json('/api/board')) as Board
	assert.equal(restored.shapes[0].id, note.id)
	assert.equal((restored.shapes[0] as { text?: string }).text, 'Container persistence verified')
	assert.deepEqual(await json('/api/ai/settings'), saved)
	assert.deepEqual(
		Buffer.from(await (await fetch(`${url}/api/images/${uploaded.id}`)).arrayBuffer()),
		png,
	)
	assert.match(
		container(['exec', containerName, 'node', 'src/cli/index.ts', 'board', 'get']),
		/Container persistence verified/,
	)
	assert.equal(container(['exec', containerName, 'id', '-u']).trim(), '1000')
	container([
		'exec',
		containerName,
		'node',
		'-e',
		"const fs=require('node:fs'); if(fs.existsSync('/app/.env')||fs.existsSync('/app/node_modules/vite')) process.exit(1); if((fs.statSync('/home/node/.config/mico/settings.json').mode&511)!==384) process.exit(1)",
	])

	console.log(`Apple container smoke passed. Artifacts: ${artifacts}`)
} finally {
	await browser?.close()
	writeFileSync(join(artifacts, 'container.log'), container(['logs', containerName], true))
	container(['stop', containerName], true)
	container(['rm', containerName], true)
	container(['volume', 'rm', dataVolume], true)
	container(['volume', 'rm', settingsVolume], true)
	container(['image', 'rm', image], true)
	rmSync(buildDir, { recursive: true, force: true })
	proxy.close()
}
