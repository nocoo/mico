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
		if (!panel) throw new Error('Missing design panel')
		return {
			scrollWidth: root.scrollWidth,
			clientWidth: root.clientWidth,
			scrollHeight: root.scrollHeight,
			clientHeight: root.clientHeight,
			reportBottom: report.getBoundingClientRect().bottom,
			panelRadius: getComputedStyle(panel).borderRadius,
		}
	})
	expect(metrics.scrollWidth).toBe(metrics.clientWidth)
	expect(metrics.scrollHeight).toBe(metrics.clientHeight)
	expect(metrics.reportBottom).toBeLessThanOrEqual(metrics.clientHeight)
	expect(metrics.panelRadius).toBe('20px')
	await page.locator('[data-shape-id="design-card"]').screenshot({
		path: testInfo.outputPath('html-card-design.png'),
		animations: 'disabled',
	})
})
