import { HTML_CARD_CSS } from '../shared/htmlCardDesign.ts'

const CARD_CSP =
	"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'\">"

export const HTML_CARD_SANDBOX = 'allow-scripts'

let cachedCss: string | undefined
let cachedJs: string | undefined
let cachedHead = ''

function frameworkHead(bootstrapCss: string, bootstrapJs: string): string {
	if (cachedCss !== bootstrapCss || cachedJs !== bootstrapJs) {
		cachedCss = bootstrapCss
		cachedJs = bootstrapJs
		cachedHead = `${CARD_CSP}<style>${bootstrapCss}\n${HTML_CARD_CSS}</style><script>${bootstrapJs}</script>`
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
