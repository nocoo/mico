import { Button, Checkbox, Select, TextField, Theme } from '@radix-ui/themes'
import { useAiSettingsViewModel } from './useAiSettingsViewModel'

export function AiSettings({ active }: { active: boolean }) {
	const model = useAiSettingsViewModel({ active })

	return (
		<Theme className="ai-settings" hasBackground={false}>
			{model.settings ? (
				<form onSubmit={model.save} className="ai-settings-form">
					<label className="ai-settings-field" htmlFor="ai-settings-endpoint">
						<span>Endpoint</span>
						<TextField.Root
							id="ai-settings-endpoint"
							type="url"
							required
							value={model.baseURL}
							onChange={(event) => model.setBaseURL(event.target.value)}
						/>
					</label>
					<div className="ai-settings-field">
						<label htmlFor="ai-settings-model">Model</label>
						<Select.Root
							value={model.models.includes(model.model) ? model.model : ''}
							onValueChange={model.setModel}
						>
							<TextField.Root
								id="ai-settings-model"
								aria-describedby="ai-settings-model-note"
								required
								value={model.model}
								onChange={(event) => model.setModel(event.target.value)}
							>
								<TextField.Slot side="right">
									<Select.Trigger
										aria-label="Choose model"
										className="ai-model-select"
										variant="ghost"
										disabled={model.models.length === 0}
									/>
								</TextField.Slot>
							</TextField.Root>
							<Select.Content
								position="popper"
								sideOffset={6}
								collisionPadding={8}
								className="select-content"
							>
								{model.models.map((name) => (
									<Select.Item className="select-item" key={name} value={name}>
										{name}
									</Select.Item>
								))}
							</Select.Content>
						</Select.Root>
					</div>
					<p id="ai-settings-model-note" className="ai-settings-note" aria-live="polite">
						{model.modelNote}
					</p>
					<label className="ai-settings-field" htmlFor="ai-settings-key">
						<span>API key</span>
						<TextField.Root
							id="ai-settings-key"
							type="password"
							autoComplete="new-password"
							value={model.apiKey}
							onChange={(event) => model.setApiKey(event.target.value)}
							disabled={model.clearKey}
							placeholder={
								model.settings.hasApiKey ? 'Leave blank to keep current key' : 'Optional'
							}
						/>
					</label>
					{model.settings.hasApiKey && (
						<label className="ai-settings-clear" htmlFor="ai-settings-clear-key">
							<Checkbox
								id="ai-settings-clear-key"
								checked={model.clearKey}
								onCheckedChange={(checked) => model.setClearKey(checked === true)}
							/>
							Remove current API key
						</label>
					)}
					<p className="ai-settings-note">
						The key is stored locally in ~/.config/mico and is never displayed again. Use HTTPS for
						remote endpoints.
					</p>
					<Button type="submit" disabled={model.saving}>
						{model.saving ? 'Saving…' : 'Save settings'}
					</Button>
				</form>
			) : model.loading ? (
				<p className="ai-settings-note">Loading settings…</p>
			) : (
				<Button type="button" onClick={() => void model.load()}>
					Retry
				</Button>
			)}
			{model.message && (
				<p
					className={model.failed ? 'ai-settings-error' : 'ai-settings-note'}
					role={model.failed ? 'alert' : 'status'}
				>
					{model.message}
				</p>
			)}
		</Theme>
	)
}
