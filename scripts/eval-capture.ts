import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { type Browser, chromium, type Page } from '@playwright/test'
import type { Board } from '../src/shared/types.ts'

const BASE_URL = 'http://127.0.0.1:27063'

export function validateCaptureRunDirectory(value: string | undefined): string {
	if (!value) throw new Error('Usage: node scripts/eval-capture.ts <eval-run-directory>')
	const runDirectory = resolve(value)
	if (existsSync(runDirectory)) {
		const stat = statSync(runDirectory)
		if (!stat.isDirectory()) throw new Error(`Eval run path is not a directory: ${runDirectory}`)
	}
	mkdirSync(runDirectory, { recursive: true })
	return runDirectory
}

export function assertBoardRenderable(board: Board): void {
	if (!Array.isArray(board.shapes) || board.shapes.length === 0) {
		throw new Error('Board has no shapes; refusing capture success')
	}
}

export function assertStableCapture(
	snapshot: Board,
	current: Board,
	renderedShapeCount: number,
): void {
	if (snapshot.revision !== current.revision) {
		throw new Error(
			`Board revision changed during capture: ${snapshot.revision} -> ${current.revision}`,
		)
	}
	if (!isDeepStrictEqual(snapshot.shapes, current.shapes)) {
		throw new Error('Board shapes changed during capture')
	}
	if (renderedShapeCount !== snapshot.shapes.length) {
		throw new Error(
			`Rendered shape count mismatch: DOM=${renderedShapeCount}, board=${snapshot.shapes.length}`,
		)
	}
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function captureFailure(
	runDirectory: string,
	page: Page | undefined,
	error: unknown,
	board?: Board,
): Promise<void> {
	writeJson(resolve(runDirectory, 'failure.json'), {
		status: 'failure',
		capturedAt: new Date().toISOString(),
		baseUrl: BASE_URL,
		error: error instanceof Error ? error.message : String(error),
		boardRevision: board?.revision,
		shapeCount: board?.shapes.length,
	})
	if (!board && page) {
		try {
			const boardResponse = await page.request.get(`${BASE_URL}/api/board`, { timeout: 10000 })
			if (boardResponse.ok()) board = (await boardResponse.json()) as Board
		} catch {}
	}
	if (board) writeJson(resolve(runDirectory, 'board.json'), board)
	if (page) {
		try {
			await page.screenshot({
				path: resolve(runDirectory, 'screenshot.png'),
				fullPage: false,
				animations: 'disabled',
			})
		} catch (screenshotError) {
			console.error(
				`Could not capture failure screenshot: ${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`,
			)
		}
	}
}

export async function captureEval(runDirectoryValue: string | undefined): Promise<{
	board: Board
	boardPath: string
	screenshotPath: string
}> {
	const runDirectory = validateCaptureRunDirectory(runDirectoryValue)
	let browser: Browser | undefined
	let page: Page | undefined
	let board: Board | undefined

	try {
		browser = await chromium.launch({
			channel: 'chrome',
			headless: true,
			args: ['--use-mock-keychain', '--disable-sync'],
		})
		page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })

		const liveResponse = await fetch(`${BASE_URL}/api/live`, {
			signal: AbortSignal.timeout(10000),
		})
		if (!liveResponse.ok) throw new Error(`/api/live returned HTTP ${liveResponse.status}`)
		const live = (await liveResponse.json()) as { status?: string }
		if (live.status !== 'ok') {
			throw new Error(`/api/live returned status ${live.status ?? 'missing'}`)
		}
		await page.waitForFunction(
			() => document.querySelector('.status')?.getAttribute('aria-label') === 'Live',
			undefined,
			{ timeout: 15000 },
		)

		const boardResponse = await page.request.get(`${BASE_URL}/api/board`, {
			timeout: 10000,
		})
		if (!boardResponse.ok()) throw new Error(`/api/board returned HTTP ${boardResponse.status()}`)
		const snapshot = (await boardResponse.json()) as Board
		board = snapshot
		assertBoardRenderable(snapshot)

		await page.waitForFunction(
			(count) => document.querySelectorAll('.canvas-shape').length === count,
			snapshot.shapes.length,
			{ timeout: 15000 },
		)
		await page.evaluate(() => document.fonts.ready.then(() => true))
		await page.waitForTimeout(250)

		const stableResponse = await page.request.get(`${BASE_URL}/api/board`, {
			timeout: 10000,
		})
		if (!stableResponse.ok()) {
			throw new Error(`/api/board returned HTTP ${stableResponse.status()} during stability check`)
		}
		const stable = (await stableResponse.json()) as Board
		const renderedShapeCount = await page.locator('.canvas-shape').count()
		assertStableCapture(snapshot, stable, renderedShapeCount)
		board = stable
		await page.waitForTimeout(250)

		const boardPath = resolve(runDirectory, 'board.json')
		const screenshotPath = resolve(runDirectory, 'screenshot.png')
		writeJson(boardPath, stable)
		await page.screenshot({
			path: screenshotPath,
			fullPage: false,
			animations: 'disabled',
		})

		return { board: stable, boardPath, screenshotPath }
	} catch (error) {
		await captureFailure(runDirectory, page, error, board)
		throw error
	} finally {
		await browser?.close()
	}
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	captureEval(process.argv[2])
		.then((result) => {
			console.log(
				JSON.stringify(
					{
						status: 'success',
						baseUrl: BASE_URL,
						revision: result.board.revision,
						shapeCount: result.board.shapes.length,
						boardPath: result.boardPath,
						screenshotPath: result.screenshotPath,
					},
					null,
					2,
				),
			)
		})
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error))
			process.exitCode = 1
		})
}
