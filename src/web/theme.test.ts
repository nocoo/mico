import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	detectSystemTheme,
	normalizeThemePreference,
	readThemePreference,
	resolveTheme,
	THEME_STORAGE_KEY,
} from './theme.ts'

test('normalizeThemePreference handles system/auto, explicit modes, and invalid values', () => {
	assert.equal(normalizeThemePreference('light'), 'light')
	assert.equal(normalizeThemePreference(' DARK '), 'dark')
	assert.equal(normalizeThemePreference('system'), 'system')
	assert.equal(normalizeThemePreference('auto'), 'system')
	assert.equal(normalizeThemePreference('sepia'), null)
	assert.equal(normalizeThemePreference(''), null)
	assert.equal(normalizeThemePreference(null), null)
})

test('readThemePreference prefers URL query override over stored preference and defaults to system', () => {
	const mapStorage = (initial: Record<string, string>) => ({
		getItem: (key: string) => initial[key] ?? null,
	})

	assert.equal(readThemePreference('', mapStorage({})), 'system')
	assert.equal(readThemePreference('', mapStorage({ [THEME_STORAGE_KEY]: 'dark' })), 'dark')
	assert.equal(readThemePreference('', mapStorage({ [THEME_STORAGE_KEY]: 'light' })), 'light')
	assert.equal(
		readThemePreference('?theme=dark', mapStorage({ [THEME_STORAGE_KEY]: 'light' })),
		'dark',
	)
	assert.equal(
		readThemePreference('?Theme=auto', mapStorage({ [THEME_STORAGE_KEY]: 'dark' })),
		'system',
	)
	assert.equal(
		readThemePreference('?theme=invalid', mapStorage({ [THEME_STORAGE_KEY]: 'dark' })),
		'dark',
	)
})

test('detectSystemTheme and resolveTheme track prefers-color-scheme only in system mode', () => {
	assert.equal(detectSystemTheme({ matchMedia: () => ({ matches: true }) }), 'dark')
	assert.equal(detectSystemTheme({ matchMedia: () => ({ matches: false }) }), 'light')
	assert.equal(detectSystemTheme({}), 'light')

	assert.equal(resolveTheme('system', 'dark'), 'dark')
	assert.equal(resolveTheme('system', 'light'), 'light')
	assert.equal(resolveTheme('light', 'dark'), 'light')
	assert.equal(resolveTheme('dark', 'light'), 'dark')
})
