import { Button, Checkbox, Select, TextField, Theme } from '@radix-ui/themes'
import { useAiSettingsViewModel } from './useAiSettingsViewModel'

export function AiSettings({ active }: { active: boolean }) {
	const model = useAiSettingsViewModel({ active })

	return (
		<Theme className="ai-settings" hasBackground={false}>
			{model.settings ? (
				<form onSubmit={model.save} className="ai-settings-form">
					{model.settings.readOnly && (
						<p className="ai-settings-note" role="status">
							AI settings are managed by this deployment and cannot be changed here.
						</p>
					)}
					<label className="ai-settings-field" htmlFor="ai-settings-endpoint">
						<span>Endpoint</span>
						<TextField.Root
							id="ai-settings-endpoint"
							type="url"
							required
							disabled={model.settings.readOnly}
							value={model.baseURL}
							onChange={(event) => model.setBaseURL(event.target.value)}
						/>
					</label>
					<div className="ai-settings-field">
						<label htmlFor="ai-settings-model">Model</label>
						<Select.Root
							value={model.models.includes(model.model) ? model.model : ''}
							onValueChange={model.setModel}
							disabled={model.settings.readOnly}
						>
							<TextField.Root
								id="ai-settings-model"
								aria-describedby={model.settings.readOnly ? undefined : 'ai-settings-model-note'}
								required
								disabled={model.settings.readOnly}
								value={model.model}
								onChange={(event) => model.setModel(event.target.value)}
							>
								<TextField.Slot side="right">
									<Select.Trigger
										aria-label="Choose model"
										className="ai-model-select"
										variant="ghost"
										disabled={model.settings.readOnly || model.models.length === 0}
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
					{!model.settings.readOnly && (
						<p id="ai-settings-model-note" className="ai-settings-note" aria-live="polite">
							{model.modelNote}
						</p>
					)}
					<label className="ai-settings-field" htmlFor="ai-settings-key">
						<span>API key</span>
						<TextField.Root
							id="ai-settings-key"
							type="password"
							autoComplete="new-password"
							value={model.apiKey}
							onChange={(event) => model.setApiKey(event.target.value)}
							disabled={model.settings.readOnly || model.clearKey}
							placeholder={
								model.settings.readOnly
									? model.settings.hasApiKey
										? 'Configured by deployment'
										: 'Not configured'
									: model.settings.hasApiKey
										? 'Leave blank to keep current key'
										: 'Optional'
							}
						/>
					</label>
					{model.settings.hasApiKey && (
						<label className="ai-settings-clear" htmlFor="ai-settings-clear-key">
							<Checkbox
								id="ai-settings-clear-key"
								checked={model.clearKey}
								disabled={model.settings.readOnly}
								onCheckedChange={(checked) => model.setClearKey(checked === true)}
							/>
							Remove current API key
						</label>
					)}
					{!model.settings.readOnly && (
						<p className="ai-settings-note">
							The key is stored locally in ~/.config/mico and is never displayed again. Use HTTPS
							for remote endpoints.
						</p>
					)}
					<Button type="submit" disabled={model.settings.readOnly || model.saving}>
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
