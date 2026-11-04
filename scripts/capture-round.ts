import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const round = Number(process.argv[2] ?? 1)
const API = process.env.MICO_API ?? 'http://127.0.0.1:37063'
const DEV = process.env.MICO_DEV ?? 'http://127.0.0.1:7063'
const dir = join('evals', 'runs', `round${round}`)
const shots = join(dir, 'shots')
mkdirSync(shots, { recursive: true })

const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as {
	cases: { id: string; canvasId: string }[]
}
const state = (await (await fetch(`${API}/api/state`)).json()) as { activeCanvasId: string }
const initial = state.activeCanvasId
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
try {
	for (const item of summary.cases) {
		await fetch(`${API}/api/active-canvas`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: item.canvasId }),
		})
		await page.goto(DEV, { waitUntil: 'networkidle' })
		await page.locator('.status[aria-label="Live"]').waitFor({ timeout: 15_000 })
		await page.waitForTimeout(400)
		await page.getByRole('button', { name: 'Fit board' }).click()
		await page.waitForTimeout(400)
		await page.screenshot({ path: join(shots, `${item.id}.png`), scale: 'css' })
		console.log('shot', item.id)
	}
} finally {
	await fetch(`${API}/api/active-canvas`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: initial }),
	}).catch(() => {})
	await browser.close()
}
