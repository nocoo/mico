import { Play } from 'lucide-react'
import './empty.css'

interface EmptyStateProps {
	onOpenAssistant: () => void
	onDismiss: () => void
}

export function EmptyState({ onOpenAssistant, onDismiss }: EmptyStateProps) {
	return (
		<section className="frame-empty" aria-label="Get started with Mico">
			<div className="frame-empty-orb" aria-hidden="true">
				<i />
				<i />
				<i />
			</div>
			<h1>会议开始，白板自己生长</h1>
			<p>Mico 聆听讨论，把观点、逻辑与结论实时落在画布上。你只管专注讨论。</p>
			<div className="frame-empty-actions">
				<button type="button" className="frame-empty-primary" onClick={onOpenAssistant}>
					<Play size={18} aria-hidden="true" />
					打开 Mico 助手
				</button>
				<button type="button" onClick={onDismiss}>
					直接使用画布
				</button>
			</div>
			<div className="frame-empty-hint">空格 + 拖拽平移 · 滚轮缩放 · 双击编辑</div>
		</section>
	)
}
