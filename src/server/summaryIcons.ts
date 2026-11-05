import {
	Activity,
	BedDouble,
	CircleCheck,
	ClipboardList,
	Clock3,
	FlaskConical,
	HeartPulse,
	ListChecks,
	ScanLine,
	ShieldCheck,
	TriangleAlert,
	Users,
} from 'lucide-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const icons = {
	activity: Activity,
	'bed-double': BedDouble,
	'circle-check': CircleCheck,
	'clipboard-list': ClipboardList,
	'clock-3': Clock3,
	'flask-conical': FlaskConical,
	'heart-pulse': HeartPulse,
	'list-checks': ListChecks,
	'scan-line': ScanLine,
	'shield-check': ShieldCheck,
	'triangle-alert': TriangleAlert,
	users: Users,
} as const

export const SUMMARY_ICON_NAMES = Object.keys(icons)

export function expandLucideIcons(html: string): string {
	return html.replace(
		/<i\s+data-lucide=["']([a-z0-9-]+)["']\s*><\/i>/g,
		(original, name: string) => {
			if (!Object.hasOwn(icons, name)) return original
			const icon = icons[name as keyof typeof icons]
			return renderToStaticMarkup(createElement(icon, { 'aria-hidden': true }))
		},
	)
}
