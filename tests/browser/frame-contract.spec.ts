import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { ISOLATED_ORIGIN, resetBoard } from './support'

const GEOMETRY_TOLERANCE = 1

interface Box {
	x: number
	y: number
	width: number
	height: number
}

function prototypeUrl(name: string): string {
	return pathToFileURL(resolve(process.cwd(), 'docs/prototypes', name)).href
}

async function getBox(locator: Locator, label: string): Promise<Box> {
	const box = await locator.boundingBox()
	if (!box) throw new Error(`Missing bounding box: ${label}`)
	return box
}

async function waitForAnimation(locator: Locator): Promise<void> {
	await locator.evaluate(async (element) => {
		await Promise.all(
			element.getAnimations().map((animation) => animation.finished.catch(() => {})),
		)
	})
}

function expectBox(actual: Box, expected: Box, label: string) {
	for (const key of ['x', 'y', 'width', 'height'] as const) {
		expect(
			Math.abs(actual[key] - expected[key]),
			`${label}.${key}: ${actual[key]} vs ${expected[key]}`,
		).toBeLessThanOrEqual(GEOMETRY_TOLERANCE)
	}
}

async function computedStyles(
	locator: Locator,
	properties: readonly string[],
): Promise<Record<string, string>> {
	return locator.evaluate((element, names) => {
		const styles = getComputedStyle(element)
		return Object.fromEntries(
			names.map((name) => [
				name,
				styles.getPropertyValue(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)),
			]),
		)
	}, properties)
}

async function pseudoStyles(
	locator: Locator,
	pseudo: '::before' | '::after',
	properties: readonly string[],
): Promise<Record<string, string>> {
	return locator.evaluate(
		(element, { names, pseudoElement }) => {
			const styles = getComputedStyle(element, pseudoElement)
			return Object.fromEntries(
				names.map((name) => [
					name,
					styles.getPropertyValue(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)),
				]),
			)
		},
		{ names: properties, pseudoElement: pseudo },
	)
}

async function openPrototype(page: Page, name: string) {
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.goto(prototypeUrl(name))
	await expect(page.locator('body')).toBeVisible()
}

async function openRealApp(page: Page) {
	await page.setViewportSize({ width: 1440, height: 960 })
	await page.goto('/')
	await expect(page.locator('.status')).toHaveAttribute('aria-label', 'Live')
}

test.beforeEach(async ({ request, baseURL }) => {
	if (baseURL !== ISOLATED_ORIGIN) throw new Error('Refusing to mutate a non-isolated canvas')
	await resetBoard(request, [])
})

test('identity and canvas manager match the approved canvas-manager geometry', async ({ page }) => {
	await openPrototype(page, 'canvas-manager.html')
	await waitForAnimation(page.locator('.canvas-panel'))
	const prototype = {
		identity: await getBox(page.locator('.identity'), 'prototype identity'),
		brandMark: await getBox(page.locator('.brand-mark'), 'prototype brand mark'),
		canvasToggle: await getBox(page.locator('#canvas-toggle'), 'prototype canvas toggle'),
		panel: await getBox(page.locator('.canvas-panel'), 'prototype canvas panel'),
		panelHeader: await getBox(page.locator('.panel-header'), 'prototype canvas header'),
		add: await getBox(page.locator('#new-canvas'), 'prototype new canvas'),
		activeItem: await getBox(page.locator('.canvas-item.active'), 'prototype active item'),
		preview: await getBox(page.locator('.canvas-item.active .canvas-preview'), 'prototype preview'),
		activeMarker: await getBox(page.locator('.canvas-active'), 'prototype active marker'),
		statusDot: await getBox(page.locator('.status-dot'), 'prototype status dot'),
	}
	const prototypeStatus = await computedStyles(page.locator('.status-dot'), [
		'width',
		'height',
		'backgroundImage',
		'boxShadow',
		'animationDuration',
	])
	const prototypeActive = await computedStyles(page.locator('.canvas-item.active'), [
		'backgroundColor',
		'borderRadius',
		'boxShadow',
	])

	await openRealApp(page)
	const canvasToggle = page.locator('[data-canvas-toggle="true"]')
	await canvasToggle.click()
	await expect(canvasToggle).toHaveAttribute('aria-expanded', 'true')

	const panel = page.locator('section.frame-identity.canvas-panel')
	await expect(panel).toBeVisible()
	await expect(panel).toHaveAttribute('data-state', 'open')
	await waitForAnimation(panel)

	const real = {
		identity: await getBox(page.locator('.topbar.frame-identity .identity-panel'), 'real identity'),
		brandMark: await getBox(page.locator('.topbar.frame-identity .brand-mark'), 'real brand mark'),
		canvasToggle: await getBox(canvasToggle, 'real canvas toggle'),
		panel: await getBox(panel, 'real canvas panel'),
		panelHeader: await getBox(panel.locator('.canvas-panel-header'), 'real canvas header'),
		add: await getBox(
			panel.getByRole('button', { name: 'New canvas', exact: true }),
			'real new canvas',
		),
		activeItem: await getBox(panel.locator('.canvas-item.active'), 'real active item'),
		preview: await getBox(panel.locator('.canvas-item.active .canvas-preview'), 'real preview'),
		activeMarker: await getBox(panel.locator('.canvas-active'), 'real active marker'),
		statusDot: await getBox(page.locator('.ai-assistant .status-dot'), 'real status dot'),
	}

	expectBox(real.identity, prototype.identity, 'identity panel')
	expectBox(real.brandMark, prototype.brandMark, 'brand mark')
	expectBox(real.canvasToggle, prototype.canvasToggle, 'canvas toggle')
	expectBox(
		real.panel,
		{ ...prototype.panel, height: real.panel.height },
		'canvas panel position and width',
	)
	expectBox(
		real.panelHeader,
		{ ...prototype.panelHeader, height: prototype.panelHeader.height },
		'canvas panel header',
	)
	expectBox(real.add, prototype.add, 'new canvas control')
	expectBox(real.activeItem, prototype.activeItem, 'active canvas item')
	expectBox(real.preview, prototype.preview, 'canvas preview')
	expectBox(real.activeMarker, prototype.activeMarker, 'active canvas marker')
	expect(real.statusDot.width).toBeCloseTo(prototype.statusDot.width, 0)
	expect(real.statusDot.height).toBeCloseTo(prototype.statusDot.height, 0)

	const realStatus = await computedStyles(page.locator('.ai-assistant .status-dot'), [
		'width',
		'height',
		'backgroundImage',
		'boxShadow',
		'animationDuration',
	])
	for (const property of ['width', 'height', 'animationDuration'] as const) {
		expect(realStatus[property], `status ${property}`).toBe(prototypeStatus[property])
	}

	const realActive = await computedStyles(panel.locator('.canvas-item.active'), [
		'backgroundColor',
		'borderRadius',
		'boxShadow',
	])
	expect(realActive.backgroundColor).toBe(prototypeActive.backgroundColor)
	expect(realActive.borderRadius).toBe(prototypeActive.borderRadius)

	await canvasToggle.click()
	await expect(canvasToggle).toHaveAttribute('aria-expanded', 'false')
	await expect(canvasToggle).toHaveAttribute('aria-label', 'Canvases')
	await expect(panel).toHaveAttribute('data-state', 'closed')

	await canvasToggle.click()
	await expect(panel).toHaveAttribute('data-state', 'open')
	await expect(canvasToggle).toHaveAttribute('aria-expanded', 'true')
})

test('toolbar frame matches the approved toolbar geometry and control sizes', async ({ page }) => {
	await openPrototype(page, 'toolbar.html')
	const prototype = {
		toolbar: await getBox(page.locator('.toolbar'), 'prototype toolbar'),
		dock: await getBox(page.locator('.dock-main'), 'prototype dock'),
		select: await getBox(
			page.getByRole('button', { name: 'Select', exact: true }),
			'prototype select',
		),
		zoom: await getBox(
			page.getByRole('button', { name: 'Reset view', exact: true }),
			'prototype zoom',
		),
		delete: await getBox(
			page.getByRole('button', { name: 'Delete selected', exact: true }),
			'prototype delete',
		),
		fit: await getBox(
			page.getByRole('button', { name: 'Fit board', exact: true }),
			'prototype fit',
		),
	}
	const prototypeToolbarStyles = await computedStyles(page.locator('.toolbar'), [
		'padding',
		'minHeight',
		'borderRadius',
		'backgroundColor',
		'boxShadow',
	])
	const prototypeControlStyles = await computedStyles(
		page.getByRole('button', { name: 'Select', exact: true }),
		['width', 'height', 'borderRadius'],
	)

	await openRealApp(page)
	const realToolbar = page.locator('.toolbar-module.toolbar')
	const real = {
		toolbar: await getBox(realToolbar, 'real toolbar'),
		dock: await getBox(realToolbar.locator('.dock-main'), 'real dock'),
		select: await getBox(page.getByRole('button', { name: 'Select', exact: true }), 'real select'),
		zoom: await getBox(page.getByRole('button', { name: 'Reset view', exact: true }), 'real zoom'),
		delete: await getBox(
			page.getByRole('button', { name: 'Delete selected', exact: true }),
			'real delete',
		),
		fit: await getBox(page.getByRole('button', { name: 'Fit board', exact: true }), 'real fit'),
	}

	expectBox(real.toolbar, prototype.toolbar, 'toolbar frame')
	expectBox(real.dock, prototype.dock, 'toolbar dock')
	expectBox(real.select, prototype.select, 'select control')
	expectBox(real.zoom, prototype.zoom, 'zoom control')
	expectBox(real.delete, prototype.delete, 'delete control')
	expectBox(real.fit, prototype.fit, 'fit control')

	const realToolbarStyles = await computedStyles(realToolbar, [
		'padding',
		'minHeight',
		'borderRadius',
		'backgroundColor',
		'boxShadow',
	])
	for (const property of ['padding', 'minHeight', 'borderRadius', 'backgroundColor'] as const) {
		expect(realToolbarStyles[property], `toolbar ${property}`).toBe(
			prototypeToolbarStyles[property],
		)
	}

	const realControlStyles = await computedStyles(
		page.getByRole('button', { name: 'Select', exact: true }),
		['width', 'height', 'borderRadius'],
	)
	for (const property of ['width', 'height', 'borderRadius'] as const) {
		expect(realControlStyles[property], `toolbar control ${property}`).toBe(
			prototypeControlStyles[property],
		)
	}
})

test('AI trigger and panel match approved open-close and Live theme geometry', async ({ page }) => {
	await openPrototype(page, 'ai-panel.html')
	const prototypeClosed = {
		triggerShell: await getBox(page.locator('.ai-trigger'), 'prototype closed trigger shell'),
		trigger: await getBox(page.locator('#ai-trigger'), 'prototype closed trigger'),
	}

	await page.locator('#ai-trigger').click()
	await page.waitForTimeout(600)
	const prototypeOpen = {
		triggerShell: await getBox(page.locator('.ai-trigger'), 'prototype open trigger shell'),
		trigger: await getBox(page.locator('#ai-trigger'), 'prototype open trigger'),
		panel: await getBox(page.locator('#ai-panel'), 'prototype open panel'),
	}

	await page.locator('#ai-tab-audio').click()
	await expect
		.poll(
			async () => (await pseudoStyles(page.locator('#ai-panel'), '::before', ['opacity'])).opacity,
		)
		.toBe('1')
	await expect(page.locator('#ai-panel')).toHaveAttribute('data-immersive', 'true')
	await expect(page.locator('.ai-trigger')).toHaveAttribute('data-open', 'true')
	await expect(page.locator('.ai-trigger')).toHaveAttribute('data-immersive', 'true')
	const prototypeLive = {
		panelBackgroundOpacity: (await pseudoStyles(page.locator('#ai-panel'), '::before', ['opacity']))
			.opacity,
		tab: await getBox(page.locator('#ai-tab-audio'), 'prototype Live tab'),
	}

	await page.locator('#ai-trigger').click()
	await expect(page.locator('#ai-trigger')).toHaveAttribute('aria-expanded', 'false')
	await expect(page.locator('#ai-trigger')).toHaveAttribute('aria-label', 'Open AI assistant')
	await expect(page.locator('.ai-trigger')).toHaveAttribute('data-open', 'false')

	await openRealApp(page)
	const realTrigger = page.locator('[data-ai-toggle="true"]')
	const realPanel = page.locator('#ai-panel')
	await expect(realTrigger).toHaveAttribute('aria-label', 'Open AI assistant')
	await expect(realTrigger).toHaveAttribute('aria-expanded', 'false')
	await expect(realPanel).toHaveAttribute('aria-hidden', 'true')

	const realClosed = {
		triggerShell: await getBox(
			page.locator('.ai-assistant .ai-trigger'),
			'real closed trigger shell',
		),
		trigger: await getBox(realTrigger, 'real closed trigger'),
	}

	await realTrigger.click()
	await expect(realTrigger).toHaveAttribute('aria-label', 'Close AI assistant')
	await expect(realTrigger).toHaveAttribute('aria-expanded', 'true')
	await expect(realPanel).toHaveClass(/is-open/)
	await page.waitForTimeout(600)

	const realOpen = {
		triggerShell: await getBox(
			page.locator('.ai-assistant .ai-trigger'),
			'real open trigger shell',
		),
		trigger: await getBox(realTrigger, 'real open trigger'),
		panel: await getBox(realPanel, 'real open panel'),
	}

	expectBox(realClosed.triggerShell, prototypeClosed.triggerShell, 'closed AI trigger shell')
	expectBox(realClosed.trigger, prototypeClosed.trigger, 'closed AI trigger')
	expectBox(realOpen.triggerShell, prototypeOpen.triggerShell, 'open AI trigger shell')
	expectBox(realOpen.trigger, prototypeOpen.trigger, 'open AI trigger')
	expectBox(realOpen.panel, prototypeOpen.panel, 'open AI panel')

	await realPanel.getByRole('tab', { name: 'Live', exact: true }).click()
	await expect(realPanel).toHaveAttribute('data-immersive', 'true')
	await expect(page.locator('.ai-assistant .ai-trigger')).toHaveAttribute('data-immersive', 'true')
	await expect
		.poll(async () => (await pseudoStyles(realPanel, '::before', ['opacity'])).opacity)
		.toBe('1')

	const realLive = {
		panelBackgroundOpacity: (await pseudoStyles(realPanel, '::before', ['opacity'])).opacity,
		tab: await getBox(realPanel.getByRole('tab', { name: 'Live', exact: true }), 'real Live tab'),
	}
	expect(realLive.panelBackgroundOpacity).toBe(prototypeLive.panelBackgroundOpacity)
	expectBox(realLive.tab, prototypeLive.tab, 'Live tab')

	await realTrigger.click()
	await expect(realTrigger).toHaveAttribute('aria-label', 'Open AI assistant')
	await expect(realTrigger).toHaveAttribute('aria-expanded', 'false')
	await expect(realPanel).not.toHaveClass(/is-open/)
	await expect(realPanel).toHaveAttribute('aria-hidden', 'true')
})
