import { expect, test } from '@playwright/test'
import { HTML_CARD_CSS, HTML_CARD_FRAGMENTS } from '../../src/shared/htmlCardDesign'
import { CANDY_COLORS } from '../../src/shared/palette'
import { ISOLATED_ORIGIN, resetBoard } from './support'

test('jelly HTML card fragments and auto-height render cleanly inside isolated frames', async ({
	page,
	request,
}, testInfo) => {
	await resetBoard(request, [
		{
			id: 'design-card',
			type: 'html',
			x: 80,
			y: 96,
			w: 720,
			h: 720,
			color: CANDY_COLORS.blue,
			title: 'Launch plan brief',
			html: `<!doctype html><html><head><style>${HTML_CARD_CSS}</style></head><body>${HTML_CARD_FRAGMENTS}</body></html>`,
		},
		{
			id: 'auto-card',
			type: 'html',
			x: 860,
			y: 96,
			w: 680,
			h: 920,
			color: CANDY_COLORS.blue,
			title: 'Auto sized jelly card',
			html: `<main class="mico-report">
				<div class="mico-eyebrow">Topic 2</div>
				<h1>Compact Decision Card</h1>
				<section class="mico-panel mico-mint"><h2>Decision</h2><p>Approved stage plan without extra whitespace.</p></section>
				<p>Supporting standalone line directly inside .mico-report still gets vertical spacing.</p>
				<section class="mico-panel mico-peach"><h2>Constraint</h2><p>Keep peak staffing unchanged.</p></section>
			</main>`,
		},
		{
			id: 'raw-card',
			type: 'html',
			x: 1600,
			y: 96,
			w: 360,
			h: 240,
			color: CANDY_COLORS.blue,
			title: 'Custom raw card',
			html: '<div class="raw-box" style="padding:16px"><h2>Plain</h2></div>',
		},
	])

	await page.setViewportSize({ width: 1440, height: 960 })
	await page.goto(ISOLATED_ORIGIN)
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')

	const designIframe = page.locator('[data-shape-id="design-card"] iframe.html-card-frame')
	await expect(designIframe).toHaveAttribute('sandbox', 'allow-scripts')
	const designFrame = designIframe.contentFrame()
	await expect(designFrame.locator('.mico-tile')).toHaveCount(3)
	await expect(designFrame.locator('.mico-list li')).toHaveCount(2)
	await expect(designFrame.locator('.mico-table td')).toHaveCount(2)

	const designSurface = page.locator('[data-shape-id="design-card"] foreignObject:has(.html-card)')
	await expect
		.poll(async () => {
			const cardHeight = Number(await designSurface.getAttribute('height'))
			const reportBox = await designFrame.locator('.mico-report').boundingBox()
			if (!Number.isFinite(cardHeight) || !reportBox) return 999
			return Math.abs(cardHeight - reportBox.height)
		})
		.toBeLessThanOrEqual(8)

	const designMetrics = await designFrame.locator('.mico-report').evaluate((report) => {
		const style = getComputedStyle(report)
		const panel = report.querySelector('.mico-panel')
		const hero = report.querySelector('.mico-hero')
		const tile = report.querySelector('.mico-tile')
		const eyebrow = report.querySelector('.mico-eyebrow')
		const bodyStyle = getComputedStyle(document.body)
		return {
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
			scrollHeight: document.documentElement.scrollHeight,
			clientHeight: document.documentElement.clientHeight,
			panelRadius: panel ? getComputedStyle(panel).borderRadius : '',
			bodyBackground: bodyStyle.backgroundColor,
			bodyColor: bodyStyle.color,
			heroBackground: hero ? getComputedStyle(hero).backgroundImage : '',
			heroShadow: hero ? getComputedStyle(hero).boxShadow : '',
			panelBackground: panel ? getComputedStyle(panel).backgroundImage : '',
			panelShadow: panel ? getComputedStyle(panel).boxShadow : '',
			tileBackground: tile ? getComputedStyle(tile).backgroundImage : '',
			tileShadow: tile ? getComputedStyle(tile).boxShadow : '',
			eyebrowColor: eyebrow ? getComputedStyle(eyebrow).color : '',
			rowGap: Number.parseFloat(style.rowGap || style.gap || '0'),
		}
	})

	expect(designMetrics.scrollWidth).toBe(designMetrics.clientWidth)
	expect(designMetrics.scrollHeight).toBeLessThanOrEqual(designMetrics.clientHeight + 2)
	expect(designMetrics.panelRadius).toBe('20px')
	expect(designMetrics.bodyBackground).toBe('rgba(0, 0, 0, 0)')
	expect(designMetrics.bodyColor).toBe('oklch(0.27 0.04 285)')
	expect(designMetrics.heroBackground).toContain('linear-gradient')
	expect(designMetrics.heroShadow).toContain('inset')
	expect(designMetrics.panelBackground).toContain('linear-gradient')
	expect(designMetrics.panelShadow).toContain('inset')
	expect(designMetrics.tileBackground).toContain('linear-gradient')
	expect(designMetrics.tileShadow).toContain('oklch(')
	expect(designMetrics.eyebrowColor).toBe('oklch(0.47 0.035 285)')
	expect(designMetrics.rowGap).toBeGreaterThanOrEqual(12)

	await page.locator('[data-shape-id="design-card"]').screenshot({
		path: testInfo.outputPath('html-card-design.png'),
	})

	const autoFrame = page
		.locator('[data-shape-id="auto-card"] iframe.html-card-frame')
		.contentFrame()
	await expect(autoFrame.locator('.mico-peach')).toHaveCount(1)

	const autoSurface = page.locator('[data-shape-id="auto-card"] foreignObject:has(.html-card)')
	await expect
		.poll(async () => {
			const cardHeight = Number(await autoSurface.getAttribute('height'))
			const reportBox = await autoFrame.locator('.mico-report').boundingBox()
			if (!Number.isFinite(cardHeight) || !reportBox) return 999
			return Math.abs(cardHeight - reportBox.height)
		})
		.toBeLessThanOrEqual(8)

	const autoCardHeight = Number(await autoSurface.getAttribute('height'))
	expect(autoCardHeight).toBeLessThan(560)

	const autoMetrics = await autoFrame.locator('.mico-report').evaluate((report) => {
		const mint = report.querySelector('.mico-mint')
		const peach = report.querySelector('.mico-peach')
		const heroSection = report.querySelector('.mico-mint')
		const para = report.querySelector('main > p')
		const gaps =
			heroSection && para
				? para.getBoundingClientRect().top - heroSection.getBoundingClientRect().bottom
				: 0
		return {
			mintBg: mint ? getComputedStyle(mint).backgroundImage : '',
			peachBg: peach ? getComputedStyle(peach).backgroundImage : '',
			verticalGap: gaps,
		}
	})
	expect(autoMetrics.mintBg).toContain('linear-gradient')
	expect(autoMetrics.peachBg).toContain('linear-gradient')
	expect(autoMetrics.mintBg).not.toBe(autoMetrics.peachBg)
	expect(autoMetrics.verticalGap).toBeGreaterThanOrEqual(12)

	const rawSurfaceHeight = Number(
		await page
			.locator('[data-shape-id="raw-card"] foreignObject:has(.html-card)')
			.getAttribute('height'),
	)
	expect(rawSurfaceHeight).toBe(240)
})
