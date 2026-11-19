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

export function htmlCardDocument(html: string, bootstrapCss: string, bootstrapJs: string): string {
	const framework = frameworkHead(bootstrapCss, bootstrapJs)

	if (/<head[^>]*>/i.test(html)) {
		const withFramework = html.replace(/<head[^>]*>/i, (head) => `${head}${framework}`)
		if (/<!doctype\s+html/i.test(html)) {
			const withoutDoctype = withFramework.replace(/<!doctype\s+html[^>]*>/i, '')
			if (!/<html[^>]*>/i.test(html)) {
				return `<!doctype html><html>${withoutDoctype}</html>`
			}
			return withFramework
		}
		if (!/<html[^>]*>/i.test(html)) {
			return `<!doctype html><html>${withFramework}</html>`
		}
		return withFramework
	}
	if (/<html[^>]*>/i.test(html)) {
		return html.replace(/<html[^>]*>/i, (root) => `${root}<head>${framework}</head>`)
	}
	if (/<!doctype\s+html/i.test(html)) {
		const body = html.replace(/<!doctype\s+html[^>]*>/i, '').trim()
		return /<body[^>]*>/i.test(body)
			? `<!doctype html><html><head>${framework}</head>${body}</html>`
			: `<!doctype html><html><head>${framework}</head><body>${body}</body></html>`
	}
	if (/<body[^>]*>/i.test(html)) {
		return `<!doctype html><html><head>${framework}</head>${html}</html>`
	}
	return `<!doctype html><html><head>${framework}</head><body>${html}</body></html>`
}
