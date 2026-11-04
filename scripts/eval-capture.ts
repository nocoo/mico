import { closeSync, lstatSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { type Browser, chromium, type Page } from '@playwright/test'
import type { Board } from '../src/shared/types.ts'

const BASE_URL = 'http://127.0.0.1:27063'
const LOCK_NAME = '.capture.lock'
const OUTPUT_ARTIFACT_NAMES = ['board.json', 'screenshot.png', 'failure.json']

export interface CaptureLock {
	fd: number
	path: string
}

export function validateCaptureIdentity(value: string | undefined): string {
	if (!value)
		throw new Error('Usage: node scripts/eval-capture.ts <eval-run-directory> <eval-identity>')
	if (!/^[-a-zA-Z0-9_.]{8,128}$/.test(value)) {
		throw new Error('Eval identity must contain 8-128 letters, digits, dots, underscores or hyphen')
	}
	return value
}

export function validateCaptureRunDirectory(value: string | undefined): string {
	if (!value)
		throw new Error('Usage: node scripts/eval-capture.ts <eval-run-directory> <eval-identity>')
	const runDirectory = resolve(value)
	let stat: ReturnType<typeof lstatSync>
	try {
		stat = lstatSync(runDirectory)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		mkdirSync(runDirectory, { recursive: true })
		stat = lstatSync(runDirectory)
	}
	if (stat.isSymbolicLink()) throw new Error('Eval run path must not be a symlink')
	if (!stat.isDirectory()) throw new Error('Eval run path is not a directory')

	for (const name of OUTPUT_ARTIFACT_NAMES) {
		try {
			lstatSync(resolve(runDirectory, name))
			throw new Error(`Eval run already contains output artifact: ${name}`)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		}
	}
	return runDirectory
}

export function acquireCaptureLock(runDirectory: string): CaptureLock {
	for (const name of OUTPUT_ARTIFACT_NAMES) {
		try {
			lstatSync(resolve(runDirectory, name))
			throw new Error(`Eval run already contains output artifact: ${name}`)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		}
	}

	const lockPath = resolve(runDirectory, LOCK_NAME)
	let fd: number
	try {
		fd = openSync(lockPath, 'wx', 0o600)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new Error('Eval capture is already in progress')
		}
		throw error
	}
	try {
		for (const name of OUTPUT_ARTIFACT_NAMES) {
			try {
				lstatSync(resolve(runDirectory, name))
				throw new Error(`Eval run already contains output artifact: ${name}`)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
			}
		}
	} catch (error) {
		closeSync(fd)
		unlinkSync(lockPath)
		throw error
	}
	return { fd, path: lockPath }
}

export function releaseCaptureLock(lock: CaptureLock): void {
	closeSync(lock.fd)
	unlinkSync(lock.path)
}

export function assertEvalIdentity(expected: string, actual: string): void {
	if (expected !== actual) {
		throw new Error(`Eval server identity mismatch: expected ${expected}, received ${actual}`)
	}
}

export function assertBoardRenderable(board: Board): void {
	if (!Array.isArray(board.shapes) || board.shapes.length === 0) {
		throw new Error('Board has no shapes; refusing capture success')
	}
}

export function assertAppliedRevision(title: string | null, revision: number): void {
	const match = title?.match(/^Revision (\d+) · /)
	if (!match) throw new Error(`Page did not expose applied board revision ${revision}`)
	if (Number(match[1]) !== revision) {
		throw new Error(
			`Page applied board revision mismatch: expected ${revision}, received ${match[1]}`,
		)
	}
}

export function assertStableCapture(
	snapshot: Board,
	current: Board,
	renderedShapeCount: number,
	appliedRevision?: number,
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
	if (appliedRevision !== undefined && appliedRevision !== snapshot.revision) {
		throw new Error(
			`Page applied revision mismatch: board=${snapshot.revision}, page=${appliedRevision}`,
		)
	}
}

function writeExclusiveJson(path: string, value: unknown): void {
	const fd = openSync(path, 'wx', 0o600)
	try {
		writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
	} finally {
		closeSync(fd)
	}
}

function writeExclusiveFile(path: string, value: Buffer): void {
	const fd = openSync(path, 'wx', 0o600)
	try {
		writeFileSync(fd, value)
	} finally {
		closeSync(fd)
	}
}

async function getAppliedRevision(page: Page): Promise<number | undefined> {
	const title = await page.locator('.status').getAttribute('title')
	const match = title?.match(/^Revision (\d+) · /)
	return match ? Number(match[1]) : undefined
}

async function waitForAppliedRevision(page: Page, revision: number): Promise<void> {
	await page.waitForFunction(
		(expected) => {
			const title = document.querySelector('.status')?.getAttribute('title')
			const match = title?.match(/^Revision (\d+) · /)
			return match ? Number(match[1]) === expected : false
		},
		revision,
		{ timeout: 15000 },
	)
	const title = await page.locator('.status').getAttribute('title')
	assertAppliedRevision(title, revision)
}

export async function captureFailure(
	runDirectory: string,
	page: Page | undefined,
	error: unknown,
	board?: Board,
	identity?: string,
): Promise<void> {
	writeExclusiveJsonIfMissing(resolve(runDirectory, 'failure.json'), {
		status: 'failure',
		capturedAt: new Date().toISOString(),
		baseUrl: BASE_URL,
		identity,
		error: error instanceof Error ? error.message : String(error),
		boardRevision: board?.revision,
		shapeCount: board?.shapes.length,
	})
	if (!board && page) {
		try {
			const boardResponse = await page.request.get(`${BASE_URL}/api/board`, {
				timeout: 10000,
			})
			if (boardResponse.ok()) board = (await boardResponse.json()) as Board
		} catch {}
	}
	if (board) writeExclusiveJsonIfMissing(resolve(runDirectory, 'board.json'), board)
	if (page) {
		try {
			const screenshot = await page.screenshot({
				fullPage: false,
				animations: 'disabled',
			})
			writeExclusiveFileIfMissing(resolve(runDirectory, 'screenshot.png'), screenshot)
		} catch (screenshotError) {
			console.error(
				`Could not capture failure screenshot: ${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`,
			)
		}
	}
}

function writeExclusiveJsonIfMissing(path: string, value: unknown): void {
	try {
		writeExclusiveJson(path, value)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
	}
}

function writeExclusiveFileIfMissing(path: string, value: Buffer): void {
	try {
		writeExclusiveFile(path, value)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
	}
}

export async function captureEval(
	runDirectoryValue: string | undefined,
	identityValue: string | undefined,
): Promise<{
	board: Board
	boardPath: string
	screenshotPath: string
	identity: string
}> {
	const runDirectory = validateCaptureRunDirectory(runDirectoryValue)
	const identity = validateCaptureIdentity(identityValue)
	const lock = acquireCaptureLock(runDirectory)
	let browser: Browser | undefined
	let page: Page | undefined
	let board: Board | undefined

	try {
		const identityResponse = await fetch(`${BASE_URL}/__eval_identity`, {
			signal: AbortSignal.timeout(10000),
		})
		if (!identityResponse.ok) {
			throw new Error(`/__eval_identity returned HTTP ${identityResponse.status}`)
		}
		const identityPayload = (await identityResponse.json()) as { identity?: string }
		if (!identityPayload.identity) throw new Error('/__eval_identity returned no identity')
		assertEvalIdentity(identity, identityPayload.identity)

		browser = await chromium.launch({
			channel: 'chrome',
			headless: true,
			args: ['--use-mock-keychain', '--disable-sync'],
		})
		page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })

		const pageIdentity = await page
			.locator('meta[name="mico-eval-identity"]')
			.getAttribute('content')
		if (!pageIdentity) throw new Error('Eval page did not expose its server identity')
		assertEvalIdentity(identity, pageIdentity)

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
		await page.waitForFunction(
			() => document.querySelector('.canvas')?.getAttribute('data-initial-fit-ready') !== 'false',
			undefined,
			{ timeout: 15000 },
		)
		await page.waitForTimeout(250)
		await waitForAppliedRevision(page, snapshot.revision)

		const stableResponse = await page.request.get(`${BASE_URL}/api/board`, {
			timeout: 10000,
		})
		if (!stableResponse.ok()) {
			throw new Error(`/api/board returned HTTP ${stableResponse.status()} during stability check`)
		}
		const stable = (await stableResponse.json()) as Board
		const renderedShapeCount = await page.locator('.canvas-shape').count()
		const appliedRevision = await getAppliedRevision(page)
		assertStableCapture(snapshot, stable, renderedShapeCount, appliedRevision)
		await waitForAppliedRevision(page, stable.revision)
		board = stable

		await page.waitForTimeout(250)
		const screenshot = await page.screenshot({
			fullPage: false,
			animations: 'disabled',
		})

		const postResponse = await page.request.get(`${BASE_URL}/api/board`, {
			timeout: 10000,
		})
		if (!postResponse.ok()) {
			throw new Error(`/api/board returned HTTP ${postResponse.status()} after screenshot`)
		}
		const post = (await postResponse.json()) as Board
		const postRenderedShapeCount = await page.locator('.canvas-shape').count()
		await waitForAppliedRevision(page, post.revision)
		const postAppliedRevision = await getAppliedRevision(page)
		assertStableCapture(stable, post, postRenderedShapeCount, postAppliedRevision)
		board = post

		const postIdentityResponse = await fetch(`${BASE_URL}/__eval_identity`, {
			signal: AbortSignal.timeout(10000),
		})
		if (!postIdentityResponse.ok) throw new Error('Eval identity unavailable after screenshot')
		const postIdentity = (await postIdentityResponse.json()) as { identity?: string }
		assertEvalIdentity(identity, postIdentity.identity ?? '')
		const postPageIdentity = await page
			.locator('meta[name="mico-eval-identity"]')
			.getAttribute('content')
		assertEvalIdentity(identity, postPageIdentity ?? '')

		const boardPath = resolve(runDirectory, 'board.json')
		const screenshotPath = resolve(runDirectory, 'screenshot.png')
		writeExclusiveJson(boardPath, post)
		writeExclusiveFile(screenshotPath, screenshot)

		return { board: post, boardPath, screenshotPath, identity }
	} catch (error) {
		await captureFailure(runDirectory, page, error, board, identity)
		throw error
	} finally {
		try {
			await browser?.close()
		} finally {
			releaseCaptureLock(lock)
		}
	}
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	captureEval(process.argv[2], process.argv[3])
		.then((result) => {
			console.log(
				JSON.stringify(
					{
						status: 'success',
						baseUrl: BASE_URL,
						identity: result.identity,
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
