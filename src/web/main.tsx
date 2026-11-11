import { Theme } from '@radix-ui/themes'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initializeCandyPalette } from './design'
import '@radix-ui/themes/styles.css'
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

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<Theme appearance="light" accentColor="blue" grayColor="slate" radius="medium" scaling="100%">
			<App />
		</Theme>
	</React.StrictMode>,
)
