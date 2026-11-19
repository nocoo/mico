import { Button, Checkbox, Select, TextField, Theme } from '@radix-ui/themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { REASONING_EFFORT_OPTIONS } from '../../../shared/aiReasoning'
import { useI18n } from '../../i18n'
import { SelectField } from '../../SelectField'
import { type ThemePreference, useTheme } from '../../theme'
import { useAiSettingsViewModel } from './useAiSettingsViewModel'

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; icon: typeof Monitor }> = [
	{ value: 'system', icon: Monitor },
	{ value: 'light', icon: Sun },
	{ value: 'dark', icon: Moon },
]

export function AiSettings({ active }: { active: boolean }) {
	const model = useAiSettingsViewModel({ active })
	const { messages } = useI18n()
	const theme = useTheme()

	const themeLabels: Record<ThemePreference, string> = {
		system: messages.assistant.settings.themeSystem,
		light: messages.assistant.settings.themeLight,
		dark: messages.assistant.settings.themeDark,
	}

	return (
		<Theme className="ai-settings" hasBackground={false}>
			<section className="ai-settings-section" aria-labelledby="ai-settings-appearance-heading">
				<span id="ai-settings-appearance-heading" className="ai-settings-section-title">
					{messages.assistant.settings.appearanceSection}
				</span>
				<div className="ai-settings-field">
					<span id="ai-settings-theme-label">{messages.assistant.settings.theme}</span>
					<div
						className="ai-theme-switch"
						role="radiogroup"
						aria-labelledby="ai-settings-theme-label"
					>
						{THEME_OPTIONS.map(({ value, icon: Icon }) => {
							const selected = theme.preference === value
							return (
								<label
									key={value}
									className="ai-theme-option"
									data-active={selected ? 'true' : undefined}
								>
									<input
										type="radio"
										name="mico-theme"
										className="sr-only"
										value={value}
										checked={selected}
										onChange={() => theme.setPreference(value)}
									/>
									<Icon size={14} strokeWidth={2} aria-hidden="true" />
									<span>{themeLabels[value]}</span>
								</label>
							)
						})}
					</div>
				</div>
			</section>
			<hr className="ai-settings-divider" />
			<section className="ai-settings-section" aria-labelledby="ai-settings-ai-heading">
				<span id="ai-settings-ai-heading" className="ai-settings-section-title">
					{messages.assistant.settings.aiSection}
				</span>
				{model.settings ? (
					<form onSubmit={model.save} className="ai-settings-form">
						{model.settings.authMode === 'managed-identity' && (
							<p className="ai-settings-note" role="status">
								Authentication: Managed identity — no API key required.
							</p>
						)}
						{model.settings.readOnly && model.settings.authMode === 'api-key' && (
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
									align="end"
									alignOffset={-4}
									sideOffset={10}
									collisionPadding={8}
									className="select-content ai-model-menu"
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
						<div className="ai-settings-row">
							<div className="ai-settings-field">
								<label htmlFor="ai-settings-lecture-reasoning">Live / Audio reasoning</label>
								<SelectField
									id="ai-settings-lecture-reasoning"
									label="Live / Audio reasoning"
									value={model.lectureReasoning}
									options={REASONING_EFFORT_OPTIONS}
									onChange={model.setLectureReasoning}
									disabled={model.settings.readOnly}
								/>
							</div>
							<div className="ai-settings-field">
								<label htmlFor="ai-settings-chat-reasoning">Chat reasoning</label>
								<SelectField
									id="ai-settings-chat-reasoning"
									label="Chat reasoning"
									value={model.chatReasoning}
									options={REASONING_EFFORT_OPTIONS}
									onChange={model.setChatReasoning}
									disabled={model.settings.readOnly}
								/>
							</div>
						</div>
						{model.settings.authMode === 'api-key' && (
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
						)}
						{model.settings.authMode === 'api-key' && model.settings.hasApiKey && (
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
			</section>
		</Theme>
	)
}
