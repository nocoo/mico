import { expect, test } from '@playwright/test'
import { HTML_CARD_CSS, HTML_CARD_FRAGMENTS } from '../../src/shared/htmlCardDesign'
import { ISOLATED_ORIGIN, resetBoard } from './support'

test('copyable card fragments render inside the isolated HTML card', async ({
	page,
	request,
	baseURL,
}, testInfo) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [
		{
			id: 'design-card',
			type: 'html',
			x: 200,
			y: 150,
			w: 620,
			h: 550,
			color: '#00a2e1',
			title: 'Design fragments',
			html: `<!doctype html><html><head><style>${HTML_CARD_CSS}</style></head><body>${HTML_CARD_FRAGMENTS}</body></html>`,
		},
	])
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
	await page.getByRole('button', { name: 'Reset view' }).click()
	const iframe = page.locator('[data-shape-id="design-card"] iframe')
	await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
	const frame = page.frameLocator('[data-shape-id="design-card"] iframe')
	await expect(frame.locator('.mico-tile')).toHaveCount(3)
	await expect(frame.locator('.mico-list li')).toHaveCount(2)
	await expect(frame.locator('.mico-table td')).toHaveCount(2)
	const metrics = await frame.locator('.mico-report').evaluate((report) => {
		const doc = report.ownerDocument
		const root = doc.documentElement
		const panel = report.querySelector('.mico-panel')
		const hero = report.querySelector('.mico-hero')
		const tile = report.querySelector('.mico-tile')
		const eyebrow = report.querySelector('.mico-eyebrow')
		if (!panel || !hero || !tile || !eyebrow) throw new Error('Missing design fragment')
		return {
			scrollWidth: root.scrollWidth,
			clientWidth: root.clientWidth,
			scrollHeight: root.scrollHeight,
			clientHeight: root.clientHeight,
			reportBottom: report.getBoundingClientRect().bottom,
			panelRadius: getComputedStyle(panel).borderRadius,
			bodyBackground: getComputedStyle(doc.body).backgroundColor,
			bodyColor: getComputedStyle(doc.body).color,
			heroBackground: getComputedStyle(hero).backgroundImage,
			tileBackground: getComputedStyle(tile).backgroundImage,
			tileShadow: getComputedStyle(tile).boxShadow,
			eyebrowColor: getComputedStyle(eyebrow).color,
		}
	})
	expect(metrics.scrollWidth).toBe(metrics.clientWidth)
	expect(metrics.scrollHeight).toBe(metrics.clientHeight)
	expect(metrics.reportBottom).toBeLessThanOrEqual(metrics.clientHeight)
	expect(metrics.panelRadius).toBe('20px')
	expect(metrics.bodyBackground).toBe('rgba(0, 0, 0, 0)')
	expect(metrics.bodyColor).toBe('oklch(0.27 0.04 285)')
	expect(metrics.heroBackground).toBe(
		'linear-gradient(135deg, oklch(0.42 0.13 285), oklch(0.3 0.09 262))',
	)
	expect(metrics.tileBackground).toBe(
		'linear-gradient(158deg, oklch(0.968 0.0425 236 / 0.92), oklch(0.9 0.085 236 / 0.92))',
	)
	expect(metrics.tileShadow).toContain('oklch(0.7 0.1275 236 / 0.45)')
	expect(metrics.eyebrowColor).toBe('oklch(0.47 0.035 285)')
	await page.locator('[data-shape-id="design-card"]').screenshot({
		path: testInfo.outputPath('html-card-design.png'),
		animations: 'disabled',
	})
})
