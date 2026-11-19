import { Theme } from '@radix-ui/themes'
import {
	createContext,
	createElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
} from 'react'
import { getQueryParam } from '../shared/query.ts'

export type ResolvedTheme = 'light' | 'dark'
export type ThemePreference = 'system' | ResolvedTheme

export const THEME_STORAGE_KEY = 'mico.theme'

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export function normalizeThemePreference(raw: string | null | undefined): ThemePreference | null {
	if (!raw) return null
	const lower = raw.trim().toLowerCase()
	if (lower === 'light' || lower === 'dark') return lower
	if (lower === 'system' || lower === 'auto') return 'system'
	return null
}

function defaultStorage(): Pick<Storage, 'getItem'> | null {
	if (typeof window === 'undefined') return null
	try {
		return window.localStorage
	} catch {
		return null
	}
}

export function readThemePreference(
	search: string = typeof window === 'undefined' ? '' : window.location.search,
	storage: Pick<Storage, 'getItem'> | null | undefined = undefined,
): ThemePreference {
	const fromUrl = normalizeThemePreference(getQueryParam(search, 'theme'))
	if (fromUrl) return fromUrl
	try {
		const target = storage === undefined ? defaultStorage() : storage
		const stored = target?.getItem(THEME_STORAGE_KEY)
		if (stored === 'light' || stored === 'dark') return stored
	} catch {
		// Ignore storage restrictions.
	}
	return 'system'
}

export function detectSystemTheme(win?: {
	matchMedia?: (query: string) => { matches: boolean }
}): ResolvedTheme {
	const target = win ?? (typeof window === 'undefined' ? undefined : window)
	return target?.matchMedia?.(DARK_MEDIA_QUERY)?.matches ? 'dark' : 'light'
}

export function resolveTheme(
	preference: ThemePreference,
	systemTheme: ResolvedTheme = detectSystemTheme(),
): ResolvedTheme {
	return preference === 'system' ? systemTheme : preference
}

export function applyDocumentTheme(
	resolved: ResolvedTheme,
	doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): void {
	if (!doc) return
	const root = doc.documentElement
	root.dataset.theme = resolved
	root.classList.toggle('dark', resolved === 'dark')
	root.classList.toggle('light', resolved === 'light')
	root.style.colorScheme = resolved
	const meta = doc.querySelector('meta[name="theme-color"]')
	if (meta) {
		meta.setAttribute('content', resolved === 'dark' ? '#161421' : '#f5fafc')
	}
}

interface ThemeContextValue {
	readonly preference: ThemePreference
	readonly resolvedTheme: ResolvedTheme
	readonly setPreference: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue>({
	preference: 'system',
	resolvedTheme: 'light',
	setPreference: () => {},
})

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
	const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference())
	const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => detectSystemTheme())

	useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
		const media = window.matchMedia(DARK_MEDIA_QUERY)
		const onChange = () => setSystemTheme(detectSystemTheme())
		onChange()
		media.addEventListener('change', onChange)
		return () => media.removeEventListener('change', onChange)
	}, [])

	useEffect(() => {
		if (typeof window === 'undefined') return
		const onPopState = () => setPreferenceState(readThemePreference())
		window.addEventListener('popstate', onPopState)
		return () => window.removeEventListener('popstate', onPopState)
	}, [])

	const resolvedTheme = resolveTheme(preference, systemTheme)

	useLayoutEffect(() => {
		applyDocumentTheme(resolvedTheme)
	}, [resolvedTheme])

	const setPreference = useCallback((next: ThemePreference) => {
		setPreferenceState(next)
		if (typeof window === 'undefined') return
		try {
			if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
			else window.localStorage.setItem(THEME_STORAGE_KEY, next)
		} catch {
			// Ignore storage restrictions.
		}
		if (getQueryParam(window.location.search, 'theme') !== null) {
			const url = new URL(window.location.href)
			for (const key of [...url.searchParams.keys()]) {
				if (key.toLowerCase() === 'theme') url.searchParams.delete(key)
			}
			window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
		}
	}, [])

	const value = useMemo<ThemeContextValue>(
		() => ({
			preference,
			resolvedTheme,
			setPreference,
		}),
		[preference, resolvedTheme, setPreference],
	)

	return createElement(
		ThemeContext.Provider,
		{ value },
		createElement(
			Theme,
			{
				appearance: resolvedTheme,
				accentColor: 'blue',
				grayColor: 'slate',
				radius: 'medium',
				scaling: '100%',
			},
			children,
		),
	)
}

export function useTheme(): ThemeContextValue {
	return useContext(ThemeContext)
}
