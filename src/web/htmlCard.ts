import { HTML_CARD_CSS } from '../shared/htmlCardDesign.ts'

const CARD_CSP =
	"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'\">"

export const HTML_CARD_SANDBOX = 'allow-scripts'

let cachedCss: string | undefined
let cachedJs: string | undefined
let cachedHead = ''

const CARD_SIZE_SCRIPT = `(() => {
  const post = () => {
    const report = document.querySelector('.mico-report')
    if (!report) return
    const rect = report.getBoundingClientRect()
    const height = Math.ceil(Math.max(report.scrollHeight, rect.height))
    if (height > 0) window.parent.postMessage({ type: 'mico-card-size', height }, '*')
  }
  const watch = () => {
    const report = document.querySelector('.mico-report')
    if (!report) return
    post()
    if (typeof ResizeObserver === 'function') new ResizeObserver(post).observe(report)
    document.fonts?.ready?.then(post)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true })
  else watch()
})()`

function frameworkHead(bootstrapCss: string, bootstrapJs: string): string {
	if (cachedCss !== bootstrapCss || cachedJs !== bootstrapJs) {
		cachedCss = bootstrapCss
		cachedJs = bootstrapJs
		cachedHead = `${CARD_CSP}<style>${bootstrapCss}\n${HTML_CARD_CSS}</style><script>${bootstrapJs}</script><script>${CARD_SIZE_SCRIPT}</script>`
	}
	return cachedHead
}

function withCardTheme(document: string, theme: 'light' | 'dark'): string {
	if (theme !== 'dark') return document
	return document.replace(/<html(\b[^>]*)?>/i, (match, attrs = '') =>
		/\bdata-bs-theme\s*=/i.test(attrs) ? match : `<html${attrs} data-bs-theme="dark">`,
	)
}

export function htmlCardDocument(
	html: string,
	bootstrapCss: string,
	bootstrapJs: string,
	theme: 'light' | 'dark' = 'light',
): string {
	const framework = frameworkHead(bootstrapCss, bootstrapJs)

	if (/<head[^>]*>/i.test(html)) {
		const withFramework = html.replace(/<head[^>]*>/i, (head) => `${head}${framework}`)
		if (/<!doctype\s+html/i.test(html)) {
			const withoutDoctype = withFramework.replace(/<!doctype\s+html[^>]*>/i, '')
			if (!/<html[^>]*>/i.test(html)) {
				return withCardTheme(`<!doctype html><html>${withoutDoctype}</html>`, theme)
			}
			return withCardTheme(withFramework, theme)
		}
		if (!/<html[^>]*>/i.test(html)) {
			return withCardTheme(`<!doctype html><html>${withFramework}</html>`, theme)
		}
		return withCardTheme(withFramework, theme)
	}
	if (/<html[^>]*>/i.test(html)) {
		return withCardTheme(
			html.replace(/<html[^>]*>/i, (root) => `${root}<head>${framework}</head>`),
			theme,
		)
	}
	if (/<!doctype\s+html/i.test(html)) {
		const body = html.replace(/<!doctype\s+html[^>]*>/i, '').trim()
		return withCardTheme(
			/<body[^>]*>/i.test(body)
				? `<!doctype html><html><head>${framework}</head>${body}</html>`
				: `<!doctype html><html><head>${framework}</head><body>${body}</body></html>`,
			theme,
		)
	}
	if (/<body[^>]*>/i.test(html)) {
		return withCardTheme(`<!doctype html><html><head>${framework}</head>${html}</html>`, theme)
	}
	return withCardTheme(
		`<!doctype html><html><head>${framework}</head><body>${html}</body></html>`,
		theme,
	)
}
