import bootstrapCss from 'bootstrap/dist/css/bootstrap.min.css?raw'
import bootstrapJs from 'bootstrap/dist/js/bootstrap.bundle.min.js?raw'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasShape } from '../../shared/types'
import { HTML_CARD_SANDBOX, htmlCardDocument } from '../htmlCard'
import { useTheme } from '../theme'
import './html-card.css'

const BORDER_ALLOWANCE = 2

export const HtmlCardSurface = memo(function HtmlCardSurface({
	shape,
	active,
	onMeasuredHeight,
}: {
	shape: CanvasShape
	active: boolean
	onMeasuredHeight?: (height: number | null) => void
}) {
	const { resolvedTheme } = useTheme()
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
	const hasReportLayout = shape.type === 'html' && Boolean(shape.html?.includes('mico-report'))
	const document = useMemo(
		() =>
			shape.type === 'html' && shape.html
				? htmlCardDocument(shape.html, bootstrapCss, bootstrapJs, resolvedTheme)
				: null,
		[resolvedTheme, shape],
	)

	useEffect(() => {
		if (!document || !hasReportLayout) {
			setMeasuredHeight(null)
			onMeasuredHeight?.(null)
			return
		}
		const handleMessage = (event: MessageEvent) => {
			const frameWindow = iframeRef.current?.contentWindow
			if (!frameWindow || event.source !== frameWindow) return
			const payload = event.data
			if (
				typeof payload !== 'object' ||
				payload === null ||
				payload.type !== 'mico-card-size' ||
				typeof payload.height !== 'number' ||
				!Number.isFinite(payload.height) ||
				payload.height <= 0
			) {
				return
			}
			const next = Math.max(120, Math.ceil(payload.height) + BORDER_ALLOWANCE)
			setMeasuredHeight((previous) => (previous === next ? previous : next))
			onMeasuredHeight?.(next)
		}
		window.addEventListener('message', handleMessage)
		return () => window.removeEventListener('message', handleMessage)
	}, [document, hasReportLayout, onMeasuredHeight])

	const effectiveHeight = hasReportLayout && measuredHeight !== null ? measuredHeight : shape.h

	if (shape.type !== 'html') return null

	return (
		<>
			<rect
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={effectiveHeight}
				fill="transparent"
				pointerEvents="all"
			/>
			<foreignObject
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={effectiveHeight}
				overflow="visible"
				pointerEvents={active ? 'auto' : 'none'}
			>
				<div className="html-card html-card-reference-surface">
					{document ? (
						<iframe
							ref={iframeRef}
							className="html-card-frame"
							title={shape.title ?? 'HTML card'}
							sandbox={HTML_CARD_SANDBOX}
							referrerPolicy="no-referrer"
							srcDoc={document}
						/>
					) : null}
				</div>
			</foreignObject>
		</>
	)
})
