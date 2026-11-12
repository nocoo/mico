export function CanvasBackdrop() {
	return (
		<>
			<div className="canvas-backdrop" aria-hidden="true">
				<div className="canvas-aurora">
					<i />
					<i />
					<i />
					<i />
				</div>
			</div>
			<svg className="canvas-grain" aria-hidden="true">
				<filter id="canvas-grain-filter">
					<feTurbulence
						type="fractalNoise"
						baseFrequency="0.85"
						numOctaves="2"
						stitchTiles="stitch"
					/>
					<feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.45  0 0 0 0.9 0" />
				</filter>
				<rect width="100%" height="100%" filter="url(#canvas-grain-filter)" />
			</svg>
		</>
	)
}
