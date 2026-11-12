import bootstrapCss from 'bootstrap/dist/css/bootstrap.min.css?raw'
import bootstrapJs from 'bootstrap/dist/js/bootstrap.bundle.min.js?raw'
import type { CanvasShape } from '../../shared/types'
import { HTML_CARD_SANDBOX, htmlCardDocument } from '../htmlCard'
import './html-card.css'

export function HtmlCardSurface({ shape, active }: { shape: CanvasShape; active: boolean }) {
	if (shape.type !== 'html') return null

	return (
		<>
			<rect
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				fill="transparent"
				pointerEvents="all"
			/>
			<foreignObject
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				pointerEvents={active ? 'auto' : 'none'}
			>
				<div className="html-card html-card-reference-surface">
					{shape.html ? (
						<iframe
							className="html-card-frame"
							title={shape.title ?? 'HTML card'}
							sandbox={HTML_CARD_SANDBOX}
							referrerPolicy="no-referrer"
							srcDoc={htmlCardDocument(shape.html, bootstrapCss, bootstrapJs)}
						/>
					) : (
						<div className="html-card-empty">HTML content is generated through the API</div>
					)}
				</div>
			</foreignObject>
		</>
	)
}
