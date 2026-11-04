import { Button, Checkbox, TextField, Theme } from '@radix-ui/themes'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'

interface Settings {
	baseURL: string
	model: string
	hasApiKey: boolean
}

export function AiSettings() {
	const [settings, setSettings] = useState<Settings | null>(null)
	const [baseURL, setBaseURL] = useState('')
	const [model, setModel] = useState('')
	const [apiKey, setApiKey] = useState('')
	const [clearKey, setClearKey] = useState(false)
	const [loading, setLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [message, setMessage] = useState('')
	const [failed, setFailed] = useState(false)

	const load = useCallback(async (signal?: AbortSignal) => {
		setLoading(true)
		setMessage('')
		try {
			const response = await fetch('/api/ai/settings', { signal })
			if (!response.ok) throw new Error('Settings request failed')
			const next = (await response.json()) as Settings
			setSettings(next)
			setBaseURL(next.baseURL)
			setModel(next.model)
			setFailed(false)
		} catch {
			if (signal?.aborted) return
			setFailed(true)
			setMessage('Could not load AI settings.')
		} finally {
			if (!signal?.aborted) setLoading(false)
		}
	}, [])

	useEffect(() => {
		const controller = new AbortController()
		void load(controller.signal)
		return () => controller.abort()
	}, [load])

	const save = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setSaving(true)
		setMessage('')
		try {
			const response = await fetch('/api/ai/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					baseURL: baseURL.trim(),
					model: model.trim(),
					...(clearKey ? { apiKey: '' } : apiKey ? { apiKey } : {}),
				}),
			})
			if (!response.ok) throw new Error('Settings request failed')
			const next = (await response.json()) as Settings
			setSettings(next)
			setBaseURL(next.baseURL)
			setModel(next.model)
			setApiKey('')
			setClearKey(false)
			setFailed(false)
			setMessage('Settings saved.')
		} catch {
			setFailed(true)
			setMessage('Could not save AI settings. Check the endpoint and try again.')
		} finally {
			setSaving(false)
		}
	}

	return (
		<Theme className="ai-settings" hasBackground={false}>
			{settings ? (
				<form onSubmit={save} className="ai-settings-form">
					<label className="ai-settings-field" htmlFor="ai-settings-endpoint">
						<span>Endpoint</span>
						<TextField.Root
							id="ai-settings-endpoint"
							type="url"
							required
							value={baseURL}
							onChange={(event) => setBaseURL(event.target.value)}
						/>
					</label>
					<label className="ai-settings-field" htmlFor="ai-settings-model">
						<span>Model</span>
						<TextField.Root
							id="ai-settings-model"
							required
							value={model}
							onChange={(event) => setModel(event.target.value)}
						/>
					</label>
					<label className="ai-settings-field" htmlFor="ai-settings-key">
						<span>API key</span>
						<TextField.Root
							id="ai-settings-key"
							type="password"
							autoComplete="new-password"
							value={apiKey}
							onChange={(event) => setApiKey(event.target.value)}
							disabled={clearKey}
							placeholder={settings.hasApiKey ? 'Leave blank to keep current key' : 'Optional'}
						/>
					</label>
					{settings.hasApiKey && (
						<label className="ai-settings-clear" htmlFor="ai-settings-clear-key">
							<Checkbox
								id="ai-settings-clear-key"
								checked={clearKey}
								onCheckedChange={(checked) => setClearKey(checked === true)}
							/>
							Remove current API key
						</label>
					)}
					<p className="ai-settings-note">
						The key is stored locally in ~/.config/mico and is never displayed again. Use HTTPS for
						remote endpoints.
					</p>
					<Button type="submit" disabled={saving}>
						{saving ? 'Saving…' : 'Save settings'}
					</Button>
				</form>
			) : loading ? (
				<p className="ai-settings-note">Loading settings…</p>
			) : (
				<Button type="button" onClick={() => void load()}>
					Retry
				</Button>
			)}
			{message && (
				<p
					className={failed ? 'ai-settings-error' : 'ai-settings-note'}
					role={failed ? 'alert' : 'status'}
				>
					{message}
				</p>
			)}
		</Theme>
	)
}
