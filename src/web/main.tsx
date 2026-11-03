import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

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

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
)
