import { type FormEvent, useCallback, useEffect, useState } from 'react'

export interface AiSettingsData {
	baseURL: string
	model: string
	hasApiKey: boolean
	readOnly: boolean
}

export function parseAiModels(body: unknown): string[] {
	if (
		!body ||
		typeof body !== 'object' ||
		!('models' in body) ||
		!Array.isArray(body.models) ||
		!body.models.every((item: unknown) => typeof item === 'string')
	)
		throw new Error('Invalid model list')
	return [...new Set(body.models)]
}

export function buildAiSettingsPayload(
	baseURL: string,
	model: string,
	apiKey: string,
	clearKey: boolean,
) {
	return {
		baseURL: baseURL.trim(),
		model: model.trim(),
		...(clearKey ? { apiKey: '' } : apiKey ? { apiKey } : {}),
	}
}

export function useAiSettingsViewModel({ active }: { active: boolean }) {
	const [settings, setSettings] = useState<AiSettingsData | null>(null)
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
			const next = (await response.json()) as AiSettingsData
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
		if (!active || !settings || settings.readOnly) return
		const controller = new AbortController()
		setModels([])
		setModelList('loading')
		void fetch('/api/ai/models', { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error('Model list request failed')
				const nextModels = parseAiModels(await response.json())
				if (controller.signal.aborted) return
				setModels(nextModels)
				setModelList('ready')
			})
			.catch(() => {
				if (!controller.signal.aborted) setModelList('error')
			})
		return () => controller.abort()
	}, [active, settings])

	const save = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!settings || settings.readOnly) return
		setSaving(true)
		setMessage('')
		try {
			const response = await fetch('/api/ai/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(buildAiSettingsPayload(baseURL, model, apiKey, clearKey)),
			})
			if (!response.ok) throw new Error('Settings request failed')
			const next = (await response.json()) as AiSettingsData
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

	const modelNote =
		settings && (baseURL.trim().replace(/\/+$/, '') !== settings.baseURL || apiKey || clearKey)
			? 'Save the endpoint and key to refresh the model list.'
			: modelList === 'loading'
				? 'Loading available models…'
				: modelList === 'error'
					? 'Could not load models; enter a model manually.'
					: modelList === 'ready' && models.length === 0
						? 'No models returned; enter a model manually.'
						: 'Choose a model or enter one manually.'

	return {
		settings,
		baseURL,
		model,
		apiKey,
		clearKey,
		loading,
		saving,
		message,
		failed,
		models,
		modelNote,
		load,
		save,
		setBaseURL,
		setModel,
		setApiKey,
		setClearKey,
	}
}
