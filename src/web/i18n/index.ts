import {
	createContext,
	createElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'
import { getQueryParam } from '../../shared/query.ts'
import { en, type I18nMessages } from './en.ts'
import { zh } from './zh.ts'

export type Locale = 'en' | 'zh'
export type LocalePreference = 'auto' | Locale

const LOCALE_STORAGE_KEY = 'mico.locale'
const MESSAGES: Record<Locale, I18nMessages> = { en, zh }

function normalizeLocale(raw: string | null | undefined): Locale | null {
	if (!raw) return null
	const lower = raw.trim().toLowerCase()
	if (lower === 'zh' || lower.startsWith('zh-') || lower.startsWith('zh_')) return 'zh'
	if (lower === 'en' || lower.startsWith('en-') || lower.startsWith('en_')) return 'en'
	return null
}

export function detectBrowserLocale(): Locale {
	if (typeof navigator === 'undefined') return 'en'
	const candidates =
		Array.isArray(navigator.languages) && navigator.languages.length > 0
			? navigator.languages
			: [navigator.language]
	for (const candidate of candidates) {
		const resolved = normalizeLocale(candidate)
		if (resolved) return resolved
	}
	return 'en'
}

export function readLocalePreference(): LocalePreference {
	if (typeof window !== 'undefined') {
		const fromUrl = normalizeLocale(getQueryParam(window.location.search, 'lang'))
		if (fromUrl) return fromUrl
		try {
			const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
			if (stored === 'en' || stored === 'zh') return stored
		} catch {
			// Ignore storage restrictions.
		}
	}
	return 'auto'
}

export function resolveLocale(preference: LocalePreference = readLocalePreference()): Locale {
	return preference === 'auto' ? detectBrowserLocale() : preference
}

export function getMessages(locale: Locale = resolveLocale()): I18nMessages {
	return MESSAGES[locale]
}

interface I18nContextValue {
	readonly locale: Locale
	readonly preference: LocalePreference
	readonly messages: I18nMessages
	readonly setPreference: (next: LocalePreference) => void
}

const I18nContext = createContext<I18nContextValue>({
	locale: 'en',
	preference: 'auto',
	messages: en,
	setPreference: () => {},
})

export function I18nProvider({ children }: { readonly children: ReactNode }) {
	const [preference, setPreferenceState] = useState<LocalePreference>(() => readLocalePreference())
	const [browserLocale, setBrowserLocale] = useState<Locale>(() => detectBrowserLocale())

	useEffect(() => {
		if (typeof window === 'undefined') return
		const onLanguageChange = () => setBrowserLocale(detectBrowserLocale())
		window.addEventListener('languagechange', onLanguageChange)
		return () => window.removeEventListener('languagechange', onLanguageChange)
	}, [])

	const locale = preference === 'auto' ? browserLocale : preference

	useEffect(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
		}
	}, [locale])

	const setPreference = useCallback((next: LocalePreference) => {
		setPreferenceState(next)
		if (typeof window === 'undefined') return
		try {
			if (next === 'auto') window.localStorage.removeItem(LOCALE_STORAGE_KEY)
			else window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
		} catch {
			// Ignore storage restrictions.
		}
	}, [])

	const value = useMemo<I18nContextValue>(
		() => ({
			locale,
			preference,
			messages: MESSAGES[locale],
			setPreference,
		}),
		[locale, preference, setPreference],
	)

	return createElement(I18nContext.Provider, { value }, children)
}

export function useI18n(): I18nContextValue {
	return useContext(I18nContext)
}

export { en, type I18nMessages, zh }
