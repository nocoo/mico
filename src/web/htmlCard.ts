const CARD_CSP =
	'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:">'

export const HTML_CARD_SANDBOX = ''

export function htmlCardDocument(html: string): string {
	if (/<head[^>]*>/i.test(html)) {
		return html.replace(/<head[^>]*>/i, (head) => `${head}${CARD_CSP}`)
	}
	if (/<html[^>]*>/i.test(html)) {
		return html.replace(/<html[^>]*>/i, (root) => `${root}<head>${CARD_CSP}</head>`)
	}
	return `${CARD_CSP}${html}`
}
