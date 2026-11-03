import { CalendarDays, CheckSquare, GripVertical, KanbanSquare, Table2 } from 'lucide-react'
import type { CanvasShape, WidgetItem } from '../shared/types'

const icons = { todo: CheckSquare, kanban: KanbanSquare, table: Table2, timeline: CalendarDays }

const laneFor = (status: string | undefined) =>
	status === 'done' ? 'done' : status === 'doing' ? 'doing' : 'todo'

function todoRows(items: WidgetItem[]) {
	return (
		<ul className="widget-todo">
			{items.map((item) => (
				<li key={item.id} className={item.done ? 'done' : ''}>
					<span className="todo-box">{item.done ? '✓' : ''}</span>
					<span>{item.title}</span>
				</li>
			))}
		</ul>
	)
}

function kanbanColumns(items: WidgetItem[]) {
	return (
		<div className="widget-kanban">
			{(['todo', 'doing', 'done'] as const).map((status) => {
				const cards = items.filter((item) => laneFor(item.status) === status)
				return (
					<section key={status} className={`kanban-column ${status}`}>
						<header>
							<span>
								{status === 'todo' ? 'To do' : status === 'doing' ? 'In progress' : 'Done'}
							</span>
							<em>{cards.length}</em>
						</header>
						{cards.map((item) => (
							<article key={item.id}>{item.title}</article>
						))}
					</section>
				)
			})}
		</div>
	)
}

function tableRows(items: WidgetItem[], width: number) {
	return (
		<div
			className="widget-table"
			style={{ gridTemplateColumns: `${width - 220}px 92px 64px 64px` }}
		>
			<strong>Title</strong>
			<strong>Status</strong>
			<strong>Start</strong>
			<strong>End</strong>
			{items.map((item) => (
				<div className="widget-table-row" key={item.id}>
					<span>{item.title}</span>
					<em>{item.status ?? 'todo'}</em>
					<span>{item.start ?? '—'}</span>
					<span>{item.end ?? '—'}</span>
				</div>
			))}
		</div>
	)
}

function timelineRows(items: WidgetItem[]) {
	const starts = items.map((item) => item.start ?? 0)
	const ends = items.map((item) => item.end ?? 1)
	const min = Math.min(0, ...starts)
	const max = Math.max(1, ...ends)
	const span = max - min || 1
	return (
		<div className="widget-timeline">
			{(items.length ? items : [{ id: 'empty', title: 'No events' }]).map((item) => {
				const start = item.start ?? 0
				const end = item.end ?? start + 1
				return (
					<div className="timeline-row" key={item.id}>
						<span>{item.title}</span>
						<div className="timeline-track">
							<div
								className="timeline-bar"
								style={{
									left: `${((start - min) / span) * 100}%`,
									width: `${Math.max(4, ((end - start) / span) * 100)}%`,
								}}
							/>
						</div>
					</div>
				)
			})}
		</div>
	)
}

export function WidgetCard({ shape }: { shape: CanvasShape }) {
	const kind = shape.widget ?? 'todo'
	const items = shape.items ?? []
	const Icon = icons[kind]
	return (
		<foreignObject x={shape.x} y={shape.y} width={shape.w} height={shape.h} pointerEvents="none">
			<div className="widget-card" style={{ borderColor: shape.color }}>
				<header className="widget-head">
					<span className="widget-kind">
						<Icon size={14} strokeWidth={1.5} aria-hidden="true" />
						{shape.widgetTitle}
					</span>
					<span className="widget-meta">{items.length} items</span>
					<span className="card-drag">
						<GripVertical size={14} strokeWidth={1.5} aria-hidden="true" />
					</span>
				</header>
				<div className="widget-body">
					{kind === 'todo' && todoRows(items)}
					{kind === 'kanban' && kanbanColumns(items)}
					{kind === 'table' && tableRows(items, shape.w)}
					{kind === 'timeline' && timelineRows(items)}
				</div>
			</div>
		</foreignObject>
	)
}
