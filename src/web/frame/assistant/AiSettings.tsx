import { Button, Checkbox, Select, TextField, Theme } from '@radix-ui/themes'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'

interface Settings {
	baseURL: string
	model: string
	hasApiKey: boolean
}

export function AiSettings({ active }: { active: boolean }) {
	const [settings, setSettings] = useState<Settings | null>(null)
	const [baseURL, setBaseURL] = useState('')
	const [model, setModel] = useState('')
	const [apiKey, setApiKey] = useState('')
	const [clearKey, setClearKey] = useState(false)
	const [loading, setLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [message, setMessage] = useState('')
	const [failed, setFailed] = useState(false)
	const [models, setModels] = useState<string[]>([])
	const [modelList, setModelList] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

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

	useEffect(() => {
		if (!active || !settings) return
		const controller = new AbortController()
		setModels([])
		setModelList('loading')
		void fetch('/api/ai/models', { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error('Model list request failed')
				const body: unknown = await response.json()
				if (
					!body ||
					typeof body !== 'object' ||
					!('models' in body) ||
					!Array.isArray(body.models) ||
					!body.models.every((item: unknown) => typeof item === 'string')
				)
					throw new Error('Invalid model list')
				if (controller.signal.aborted) return
				setModels([...new Set(body.models)])
				setModelList('ready')
			})
			.catch(() => {
				if (!controller.signal.aborted) setModelList('error')
			})
		return () => controller.abort()
	}, [active, settings])

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
					<div className="ai-settings-field">
						<label htmlFor="ai-settings-model">Model</label>
						<Select.Root value={models.includes(model) ? model : ''} onValueChange={setModel}>
							<TextField.Root
								id="ai-settings-model"
								aria-describedby="ai-settings-model-note"
								required
								value={model}
								onChange={(event) => setModel(event.target.value)}
							>
								<TextField.Slot side="right">
									<Select.Trigger
										aria-label="Choose model"
										className="ai-model-select"
										variant="ghost"
										disabled={models.length === 0}
									/>
								</TextField.Slot>
							</TextField.Root>
							<Select.Content
								position="popper"
								sideOffset={6}
								collisionPadding={8}
								className="select-content"
							>
								{models.map((name) => (
									<Select.Item className="select-item" key={name} value={name}>
										{name}
									</Select.Item>
								))}
							</Select.Content>
						</Select.Root>
					</div>
					<p id="ai-settings-model-note" className="ai-settings-note" aria-live="polite">
						{baseURL.trim().replace(/\/+$/, '') !== settings.baseURL || apiKey || clearKey
							? 'Save the endpoint and key to refresh the model list.'
							: modelList === 'loading'
								? 'Loading available models…'
								: modelList === 'error'
									? 'Could not load models; enter a model manually.'
									: modelList === 'ready' && models.length === 0
										? 'No models returned; enter a model manually.'
										: 'Choose a model or enter one manually.'}
					</p>
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
