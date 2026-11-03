import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { CanvasShape, WidgetItem } from '../shared/types'
import { IconButton } from './IconButton'

interface WidgetEditorProps {
	shape: CanvasShape
	onPatch: (patch: { widgetTitle?: string; items?: WidgetItem[] }) => void
}

const statuses = ['todo', 'doing', 'done'] as const

export function WidgetEditor({ shape, onPatch }: WidgetEditorProps) {
	const kind = shape.widget ?? 'todo'
	const items = shape.items ?? []
	const [draft, setDraft] = useState('')

	const replace = (next: WidgetItem[]) => onPatch({ items: next })
	const change = (id: string, patch: Partial<WidgetItem>) =>
		replace(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
	const add = () => {
		const title =
			draft.trim() ||
			(kind === 'todo'
				? 'New task'
				: kind === 'kanban'
					? 'New card'
					: kind === 'table'
						? 'New row'
						: 'New event')
		replace([
			...items,
			{
				id: crypto.randomUUID(),
				title,
				...(kind === 'todo' ? { done: false } : {}),
				...(kind === 'kanban' ? { status: 'todo' } : {}),
				...(kind === 'timeline' ? { start: items.length, end: items.length + 2 } : {}),
			},
		])
		setDraft('')
	}

	return (
		<>
			<div className="property-field">
				<label className="sr-only" htmlFor="widget-title">
					Widget title
				</label>
				<input
					id="widget-title"
					key={`${shape.id}:${shape.widgetTitle}`}
					defaultValue={shape.widgetTitle}
					onBlur={(event) => {
						const widgetTitle = event.target.value.trim()
						if (widgetTitle && widgetTitle !== shape.widgetTitle) onPatch({ widgetTitle })
					}}
					onKeyDown={(event) => {
						if (event.key === 'Enter') event.currentTarget.blur()
					}}
				/>
			</div>
			<div className="widget-editor">
				<div className="widget-editor-items">
					{items.map((item) => (
						<div className="widget-editor-row" key={item.id}>
							{kind === 'todo' && (
								<input
									type="checkbox"
									checked={!!item.done}
									aria-label={`Done ${item.title}`}
									onChange={(event) => change(item.id, { done: event.target.checked })}
								/>
							)}
							<input
								aria-label={`Item ${item.title}`}
								defaultValue={item.title}
								key={`${item.id}:${item.title}`}
								onBlur={(event) => {
									const title = event.target.value.trim()
									if (title && title !== item.title) change(item.id, { title })
								}}
							/>
							{kind === 'kanban' && (
								<select
									aria-label={`Status ${item.title}`}
									value={item.status ?? 'todo'}
									onChange={(event) => change(item.id, { status: event.target.value })}
								>
									{statuses.map((status) => (
										<option key={status} value={status}>
											{status}
										</option>
									))}
								</select>
							)}
							{kind === 'timeline' && (
								<>
									<input
										type="number"
										className="widget-number"
										aria-label={`Start ${item.title}`}
										defaultValue={item.start ?? 0}
										key={`start:${item.id}:${item.start}`}
										onBlur={(event) => change(item.id, { start: Number(event.target.value) })}
									/>
									<input
										type="number"
										className="widget-number"
										aria-label={`End ${item.title}`}
										defaultValue={item.end ?? 1}
										key={`end:${item.id}:${item.end}`}
										onBlur={(event) => change(item.id, { end: Number(event.target.value) })}
									/>
								</>
							)}
							<IconButton
								icon={Trash2}
								label={`Remove ${item.title}`}
								onClick={() => replace(items.filter((candidate) => candidate.id !== item.id))}
							/>
						</div>
					))}
				</div>
				<div className="widget-editor-add">
					<input
						aria-label="New widget item"
						placeholder="Add item"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') add()
						}}
					/>
					<IconButton icon={Plus} label="Add widget item" onClick={add} />
				</div>
			</div>
		</>
	)
}
