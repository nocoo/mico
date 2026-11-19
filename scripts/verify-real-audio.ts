import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { loadAiConfig, loadRuntimeEnv } from '../src/server/aiConfig.ts'
import { createDaemon } from '../src/server/index.ts'
import { maiRealtimeProxy } from '../src/server/maiProxy.ts'
import { E2E_PORT } from '../src/shared/config.ts'
import type { Board, CanvasShape } from '../src/shared/types.ts'
import { micoViteConfig } from '../vite.config.ts'

export interface RealAudioArgs {
	confirmProviderUsage: boolean
	clipId: string
	model?: string
	summaryModel?: string
	lectureReasoning?: string
	summaryReasoning?: string
	hotMin?: number
	chunkSize?: number
	maxCatchUpMs: number
	screenshotPath?: string
	reportPath?: string
}

interface ManifestEntry {
	id: string
	lang: 'zh' | 'en' | 'ja'
	subject: string
	title: string
	duration: number
}

function parsePositiveInt(value: string, flag: string): number {
	const parsed = Number(value)
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${flag} must be a positive integer`)
	}
	return parsed
}

export function parseRealAudioArgs(argv: readonly string[]): RealAudioArgs {
	let confirmProviderUsage = false
	let clipId = 'c13-microsoft-outlook'
	let model: string | undefined
	let summaryModel: string | undefined
	let lectureReasoning: string | undefined
	let summaryReasoning: string | undefined
	let hotMin: number | undefined
	let chunkSize: number | undefined
	let maxCatchUpMs = 30_000
	let screenshotPath: string | undefined
	let reportPath: string | undefined

	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index]
		const nextValue = () => {
			const value = argv[++index]
			if (!value) throw new Error(`${flag} requires a value`)
			return value
		}
		if (flag === '--confirm-provider-usage') {
			confirmProviderUsage = true
		} else if (flag === '--clip') {
			clipId = nextValue()
		} else if (flag === '--model') {
			model = nextValue()
		} else if (flag === '--summary-model') {
			summaryModel = nextValue()
		} else if (flag === '--lecture-reasoning') {
			lectureReasoning = nextValue()
		} else if (flag === '--summary-reasoning') {
			summaryReasoning = nextValue()
		} else if (flag === '--hot-min') {
			hotMin = parsePositiveInt(nextValue(), '--hot-min')
		} else if (flag === '--chunk-size') {
			chunkSize = parsePositiveInt(nextValue(), '--chunk-size')
		} else if (flag === '--max-catch-up-ms') {
			maxCatchUpMs = parsePositiveInt(nextValue(), '--max-catch-up-ms')
		} else if (flag === '--screenshot') {
			screenshotPath = nextValue()
		} else if (flag === '--out') {
			reportPath = nextValue()
		} else {
			throw new Error(`Unknown argument: ${flag}`)
		}
	}

	if (!confirmProviderUsage) {
		throw new Error(
			'Pass --confirm-provider-usage before calling an AI gateway or MAI transcription',
		)
	}

	return {
		confirmProviderUsage,
		clipId,
		model,
		summaryModel,
		lectureReasoning,
		summaryReasoning,
		hotMin,
		chunkSize,
		maxCatchUpMs,
		screenshotPath,
		reportPath,
	}
}

function loadManifestClip(clipId: string): ManifestEntry {
	const manifest = JSON.parse(readFileSync('public/evals/manifest.json', 'utf8')) as {
		evals: ManifestEntry[]
	}
	const found = manifest.evals.find(
		(item) => item.id === clipId || item.id.startsWith(`${clipId}-`),
	)
	if (!found) throw new Error(`Unknown audio manifest clip "${clipId}"`)
	return found
}

function inspectLayout(board: Board) {
	const htmlCards = board.shapes.filter((shape): shape is CanvasShape => shape.type === 'html')
	const execCards = htmlCards.filter(
		(card) =>
			/^executive[-_]/i.test(card.id) ||
			/executive overview|总览|全局总览|会议总览/i.test(card.title ?? ''),
	)
	const stageCards = htmlCards.filter((card) => !execCards.includes(card))
	const actionCards = board.shapes.filter((shape): shape is CanvasShape => shape.type === 'actions')
	const actionItemCount = actionCards.reduce((sum, card) => sum + (card.items?.length ?? 0), 0)
	const frames = board.shapes.filter((shape) => shape.type === 'frame')
	const notes = board.shapes.filter((shape) => shape.type === 'note')
	const boxes = board.shapes.filter(
		(shape) => shape.type === 'rectangle' || shape.type === 'ellipse',
	)
	const texts = board.shapes.filter((shape) => shape.type === 'text')

	const stageCardsAtCol3Ratio =
		stageCards.length > 0
			? Number(
					(
						stageCards.filter((card) => Math.abs(card.x - 2040) <= 64).length / stageCards.length
					).toFixed(3),
				)
			: null
	const execOk = execCards.length <= 1 && execCards.every((card) => Math.abs(card.x - 3160) <= 64)
	const actionOk =
		actionCards.length <= 1 && actionCards.every((card) => Math.abs(card.x - 3160) <= 64)

	return {
		shapeCount: board.shapes.length,
		frames: frames.length,
		notes: notes.length,
		boxes: boxes.length,
		texts: texts.length,
		stageCardCount: stageCards.length,
		hasExecutiveSummary: execCards.length === 1,
		actionCardCount: actionCards.length,
		actionItemCount,
		stageCardsAtCol3Ratio,
		col4Aligned: (execCards.length > 0 || actionCards.length > 0) && execOk && actionOk,
	}
}

export async function runRealAudioVerification(args: RealAudioArgs) {
	const clip = loadManifestClip(args.clipId)
	const env = { ...loadRuntimeEnv() }
	if (args.model) env.MAGPIE_MODEL = args.model
	if (args.summaryModel) env.MAGPIE_SUMMARY_MODEL = args.summaryModel
	if (args.lectureReasoning) env.MAGPIE_LECTURE_REASONING = args.lectureReasoning
	if (args.summaryReasoning) env.MAGPIE_SUMMARY_REASONING = args.summaryReasoning
	if (args.hotMin !== undefined) env.MICO_LECTURE_HOT_MIN = String(args.hotMin)
	if (args.chunkSize !== undefined) env.MICO_LECTURE_CHUNK_SIZE = String(args.chunkSize)

	const config = loadAiConfig(env)
	if (!config.mai.host || !config.mai.apiKey || !config.mai.deployment) {
		throw new Error('Missing real MAI configuration in .env / runtime env')
	}

	const directory = mkdtempSync(join(tmpdir(), 'mico-real-audio-e2e-'))
	const daemon = createDaemon({
		port: 0,
		dbPath: join(directory, 'board.sqlite'),
		settingsPath: join(directory, 'ai-settings', 'settings.json'),
		env,
	})
	daemon.server.listen(0, '127.0.0.1')
	await once(daemon.server, 'listening', { signal: AbortSignal.timeout(10_000) })
	const daemonAddr = daemon.server.address()
	if (!daemonAddr || typeof daemonAddr === 'string') throw new Error('Invalid daemon port')

	const base = micoViteConfig()
	const vite = await createServer({
		...base,
		plugins: [...base.plugins, maiRealtimeProxy(config.mai)],
		configFile: false,
		cacheDir: join(directory, 'vite-cache'),
		server: {
			...base.server,
			port: E2E_PORT,
			strictPort: true,
			proxy: {
				'/api': {
					target: `http://127.0.0.1:${daemonAddr.port}`,
					changeOrigin: true,
					ws: true,
				},
			},
		},
	})

	let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
	try {
		await vite.listen()
		const viteUrl = `http://127.0.0.1:${E2E_PORT}`

		browser = await chromium.launch({
			headless: true,
			args: ['--autoplay-policy=no-user-gesture-required'],
		})
		const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
		const page = await context.newPage()

		let lectureChatCalls = 0
		let summaryChatCalls = 0
		let summaryResponseFinished = false
		const failedChatStatuses: number[] = []
		const requestStartAt = new WeakMap<object, number>()
		let summaryRequestElapsedMs: number | null = null

		page.on('request', (req) => {
			if (req.url().includes('/api/ai/chat') && req.method() === 'POST') {
				const body = req.postData() ?? ''
				requestStartAt.set(req, performance.now())
				if (body.includes('[Post-session summary]')) {
					summaryChatCalls++
				} else {
					lectureChatCalls++
				}
			}
		})
		page.on('response', async (res) => {
			if (res.url().includes('/api/ai/chat') && res.request().method() === 'POST') {
				if (res.status() >= 400) failedChatStatuses.push(res.status())
				const body = res.request().postData() ?? ''
				if (body.includes('[Post-session summary]')) {
					await res.finished().catch(() => undefined)
					const started = requestStartAt.get(res.request())
					if (started !== undefined) {
						summaryRequestElapsedMs = Math.round(performance.now() - started)
					}
					summaryResponseFinished = true
				}
			}
		})

		await page.goto(viteUrl, { waitUntil: 'domcontentloaded' })
		await page.locator('.status[aria-label="Live"]').waitFor({ state: 'attached', timeout: 20_000 })
		const panelElement = page.locator('#ai-panel')
		if ((await panelElement.getAttribute('aria-hidden')) === 'true') {
			await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click()
		}
		await panelElement.waitFor({ state: 'visible', timeout: 15_000 })
		const panel = page.getByRole('region', { name: 'AI assistant' })
		await panel.getByRole('tab', { name: 'Audio', exact: true }).click()
		const audioTab = panel.getByRole('tabpanel', { name: 'Audio' })

		const clipTrigger = audioTab.getByRole('combobox', { name: 'Recording', exact: true })
		await clipTrigger.waitFor({ timeout: 15_000 })
		await clipTrigger.click()
		await page
			.locator('.lesson-recording-menu .select-item')
			.filter({ hasText: clip.title })
			.first()
			.click()

		const startedAt = performance.now()
		await audioTab.getByRole('button', { name: 'Play recording', exact: true }).click()

		const audioBudgetMs = Math.max(120_000, Math.round(clip.duration * 1000) + 90_000)
		const deadlineAudio = Date.now() + audioBudgetMs
		let tAudioEnd: number | null = null
		while (Date.now() < deadlineAudio) {
			const phase = await audioTab.locator('.lesson').getAttribute('data-phase')
			if (phase === 'error') {
				const detail = ((await audioTab.locator('.lesson-status').textContent()) ?? '').trim()
				throw new Error(`Audio playback entered error state: ${detail}`)
			}
			const completeVisible = await audioTab
				.getByText('Recording complete', { exact: true })
				.isVisible()
				.catch(() => false)
			if (completeVisible && phase === 'done') {
				tAudioEnd = performance.now()
				break
			}
			await page.waitForTimeout(250)
		}
		if (tAudioEnd === null) throw new Error('Timed out waiting for Recording complete')

		const deadlineCatchUp = Date.now() + Math.max(90_000, args.maxCatchUpMs * 3)
		let caughtUpAt: number | null = null
		let summaryButtonDisabled = false
		while (Date.now() < deadlineCatchUp) {
			const errVisible = await panel
				.locator('.ai-error')
				.isVisible()
				.catch(() => false)
			if (errVisible) {
				const errText = ((await panel.locator('.ai-error').textContent()) ?? '').trim()
				throw new Error(`Assistant error during catch-up: ${errText}`)
			}
			const pillText = ((await page.locator('.ai-status-text').textContent()) ?? '').trim()
			const pillState = await page.locator('.ai-status-pill').getAttribute('data-state')
			const lessonAiCount = await audioTab.locator('.lesson-ai').count()
			summaryButtonDisabled = await audioTab
				.getByRole('button', { name: 'Create session summary', exact: true })
				.isDisabled()
			if (
				summaryResponseFinished &&
				pillState === 'idle' &&
				pillText === 'Mico is ready' &&
				lessonAiCount === 0
			) {
				caughtUpAt = performance.now()
				break
			}
			await page.waitForTimeout(150)
		}
		if (caughtUpAt === null) {
			const pillText = ((await page.locator('.ai-status-text').textContent()) ?? '').trim()
			const pillState = await page.locator('.ai-status-pill').getAttribute('data-state')
			throw new Error(
				`Timed out waiting for catch-up (summaryFinished=${summaryResponseFinished}, state="${pillState}", status="${pillText}")`,
			)
		}

		const audioPlaybackMs = Math.round(tAudioEnd - startedAt)
		const realBrowserCatchUpMs = Math.round(caughtUpAt - tAudioEnd)
		const totalElapsedMs = Math.round(caughtUpAt - startedAt)

		if (args.screenshotPath) {
			const resolvedShot = resolve(args.screenshotPath)
			await page.getByRole('button', { name: 'Close AI assistant', exact: true }).click()
			await page.waitForTimeout(400)
			await page.getByRole('button', { name: 'Fit board', exact: true }).click()
			await page.waitForTimeout(600)
			mkdirSync(dirname(resolvedShot), { recursive: true })
			await page.screenshot({ path: resolvedShot })
		}

		const canvasId = await daemon.store.getActiveCanvasId()
		const finalBoard = await daemon.store.getBoard(canvasId)
		const layout = inspectLayout(finalBoard)

		const summary = {
			generatedAt: new Date().toISOString(),
			clipId: clip.id,
			config: {
				model: config.chat.model,
				summaryModel: config.summaryModel ?? config.chat.model,
				lectureReasoning: config.lectureReasoning,
				summaryReasoning: config.summaryReasoning,
				hotMin: config.lectureHotMin,
				chunkSize: config.lectureChunkSize,
			},
			audioPlaybackMs,
			realBrowserCatchUpMs,
			totalElapsedMs,
			summaryRequestElapsedMs,
			summaryButtonDisabled,
			lectureChatCalls,
			summaryChatCalls,
			failedChatStatuses,
			layout,
			...(args.screenshotPath ? { screenshotPath: resolve(args.screenshotPath) } : {}),
		}
		if (args.reportPath) {
			const resolvedReport = resolve(args.reportPath)
			mkdirSync(dirname(resolvedReport), { recursive: true })
			writeFileSync(resolvedReport, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
		}
		console.log(JSON.stringify(summary, null, 2))

		if (failedChatStatuses.length > 0) {
			throw new Error(`Chat requests returned HTTP failures: ${failedChatStatuses.join(', ')}`)
		}
		if (realBrowserCatchUpMs > args.maxCatchUpMs) {
			throw new Error(
				`Catch-up latency ${realBrowserCatchUpMs}ms exceeded max budget ${args.maxCatchUpMs}ms`,
			)
		}
		return summary
	} finally {
		await browser?.close().catch(() => undefined)
		await vite.close().catch(() => undefined)
		for (const client of daemon.wss.clients) client.terminate()
		await daemon.close().catch(() => undefined)
		rmSync(directory, { recursive: true, force: true })
	}
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	runRealAudioVerification(parseRealAudioArgs(process.argv.slice(2))).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
