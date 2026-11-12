import type { CanvasShape } from '../../shared/types'
import { jellyStyle } from './jelly'
import './jelly.css'
import './jelly-shape.css'

export function JellyShape({ shape, editing }: { shape: CanvasShape; editing: boolean }) {
	if (shape.type !== 'rectangle' && shape.type !== 'ellipse') return null

	const text = shape.text ?? ''
	const flowNode = shape.type === 'rectangle' && text.length > 0
	const [nodeTitle, ...nodeDetails] = text.split('\n')
	const nodeSubtitle = nodeDetails.join('\n')
	const hitGeometry =
		shape.type === 'ellipse' ? (
			<ellipse
				cx={shape.x + shape.w / 2}
				cy={shape.y + shape.h / 2}
				rx={shape.w / 2}
				ry={shape.h / 2}
				fill="transparent"
				pointerEvents="all"
			/>
		) : (
			<rect
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				fill="transparent"
				pointerEvents="all"
			/>
		)

	return (
		<>
			{hitGeometry}
			<foreignObject
				x={shape.x}
				y={shape.y}
				width={shape.w}
				height={shape.h}
				overflow="visible"
				pointerEvents="none"
			>
				{flowNode ? (
					<div
						className={`jelly-shape el-node canvas-jelly${editing ? ' jelly-shape-editing' : ''}`}
						style={jellyStyle(shape.color)}
					>
						<div className="nd-t" data-edit="">
							{nodeTitle}
						</div>
						{nodeDetails.length > 0 && (
							<div className="nd-s" data-edit="">
								{nodeSubtitle}
							</div>
						)}
					</div>
				) : (
					<div
						className={`jelly-shape el-shape canvas-jelly${editing ? ' jelly-shape-editing' : ''}`}
						data-shape={shape.type}
						style={jellyStyle(shape.color)}
					>
						<div data-edit="">{text}</div>
					</div>
				)}
			</foreignObject>
		</>
	)
}
