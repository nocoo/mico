import { Theme } from '@radix-ui/themes'
import React from 'react'
import ReactDOM from 'react-dom/client'
import BootGate from './BootGate'
import { initializeCandyPalette } from './design'
import { I18nProvider } from './i18n'
import '@radix-ui/themes/tokens/base.css'
import '@radix-ui/themes/tokens/colors/blue.css'
import '@radix-ui/themes/tokens/colors/slate.css'
import '@radix-ui/themes/tokens/colors/gray.css'
import '@radix-ui/themes/tokens/colors/red.css'
import '@radix-ui/themes/components.css'
import './styles.css'
import './frame/tokens.css'

const browserZoomKeys = new Set(['+', '=', '-', '_', '0'])
window.addEventListener(
	'keydown',
	(event) => {
		if ((event.metaKey || event.ctrlKey) && browserZoomKeys.has(event.key)) event.preventDefault()
	},
	{ capture: true },
)
window.addEventListener('gesturestart', (event) => event.preventDefault())
window.addEventListener(
	'wheel',
	(event) => {
		if (event.ctrlKey || event.metaKey) event.preventDefault()
	},
	{ passive: false },
)

initializeCandyPalette(document.documentElement)

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

if (window.location.pathname === '/auth/callback' && (window.parent !== window || window.opener)) {
	void import('@azure/msal-browser/redirect-bridge')
		.then(({ broadcastResponseToMainFrame }) => broadcastResponseToMainFrame())
		.catch(() => {
			root.textContent = 'Microsoft sign-in could not be completed. Return to the main window.'
		})
} else {
	ReactDOM.createRoot(root).render(
		<React.StrictMode>
			<Theme appearance="light" accentColor="blue" grayColor="slate" radius="medium" scaling="100%">
				<I18nProvider>
					<BootGate />
				</I18nProvider>
			</Theme>
		</React.StrictMode>,
	)
}
