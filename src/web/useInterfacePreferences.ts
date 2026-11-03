import { useState } from 'react'
import { CONTROL_TIERS, type ControlTier, TEXT_TIERS, type TextTier } from './design'

interface Preferences {
	controls: ControlTier
	text: TextTier
}

const defaults: Preferences = { controls: 'standard', text: 'standard' }
const storageKey = 'mico:interface'

function loadPreferences(): Preferences {
	try {
		const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Preferences | null
		if (
			saved &&
			Object.hasOwn(CONTROL_TIERS, saved.controls) &&
			Object.hasOwn(TEXT_TIERS, saved.text)
		)
			return { controls: saved.controls, text: saved.text }
	} catch {}
	return defaults
}

export function useInterfacePreferences() {
	const [preferences, setPreferences] = useState(loadPreferences)
	const [persisted, setPersisted] = useState(true)
	const updatePreferences = (patch: Partial<Preferences>) => {
		const next = { ...preferences, ...patch }
		setPreferences(next)
		try {
			localStorage.setItem(storageKey, JSON.stringify(next))
			setPersisted(true)
		} catch {
			setPersisted(false)
		}
	}
	return { preferences, updatePreferences, persisted }
}
