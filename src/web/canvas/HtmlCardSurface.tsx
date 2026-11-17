import bootstrapCss from 'bootstrap/dist/css/bootstrap.min.css?raw'
import bootstrapJs from 'bootstrap/dist/js/bootstrap.bundle.min.js?raw'
import { memo, useMemo } from 'react'
import type { CanvasShape } from '../../shared/types'
import { HTML_CARD_SANDBOX, htmlCardDocument } from '../htmlCard'
import './html-card.css'

export const HtmlCardSurface = memo(function HtmlCardSurface({
	shape,
	active,
}: {
	shape: CanvasShape
	active: boolean
}) {
	const document = useMemo(
		() =>
			shape.type === 'html' && shape.html
				? htmlCardDocument(shape.html, bootstrapCss, bootstrapJs)
				: null,
		[shape],
	)
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
				overflow="visible"
				pointerEvents={active ? 'auto' : 'none'}
			>
				<div className="html-card html-card-reference-surface">
					{document ? (
						<iframe
							className="html-card-frame"
							title={shape.title ?? 'HTML card'}
							sandbox={HTML_CARD_SANDBOX}
							referrerPolicy="no-referrer"
							srcDoc={document}
						/>
					) : (
						<div className="html-card-empty">HTML content is generated through the API</div>
					)}
				</div>
			</foreignObject>
		</>
	)
})
