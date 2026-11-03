interface Stroke {
	id: string
	color: string
	brush: 'pencil' | 'marker' | 'brush'
	strokeWidth: number
	points: { x: number; y: number }[]
}

const strokes: Stroke[] = []
const ink = '#242424'
const base = { x: 1760, y: 980 }

function curve(
	id: string,
	points: [number, number][],
	options: Partial<Pick<Stroke, 'brush' | 'strokeWidth' | 'color'>> = {},
) {
	strokes.push({
		id,
		color: options.color ?? ink,
		brush: options.brush ?? 'brush',
		strokeWidth: options.strokeWidth ?? 4,
		points: points.map(([x, y]) => ({ x: base.x + x, y: base.y + y })),
	})
}

function arc(
	id: string,
	cx: number,
	cy: number,
	radiusX: number,
	radiusY: number,
	from: number,
	to: number,
	steps = 24,
	options: Partial<Pick<Stroke, 'brush' | 'strokeWidth' | 'color'>> = {},
) {
	curve(
		id,
		Array.from({ length: steps + 1 }, (_, index) => {
			const angle = from + ((to - from) * index) / steps
			return [cx + Math.cos(angle) * radiusX, cy + Math.sin(angle) * radiusY] as [number, number]
		}),
		options,
	)
}

curve(
	'figure-head',
	[
		[252, 132],
		[262, 128],
		[272, 132],
		[276, 142],
		[272, 152],
		[262, 156],
		[252, 152],
		[248, 142],
		[252, 132],
	],
	{ strokeWidth: 3 },
)
curve(
	'figure-body',
	[
		[262, 156],
		[258, 198],
		[262, 222],
	],
	{ strokeWidth: 4 },
)
curve(
	'figure-arms',
	[
		[236, 182],
		[262, 168],
		[290, 186],
	],
	{ brush: 'marker', strokeWidth: 6 },
)
curve(
	'figure-legs',
	[
		[240, 252],
		[262, 222],
		[286, 254],
	],
	{ strokeWidth: 5 },
)
curve(
	'figure-face',
	[
		[256, 140],
		[257, 141],
	],
	{ brush: 'pencil', strokeWidth: 3 },
)
curve(
	'figure-smile',
	[
		[255, 148],
		[260, 151],
		[266, 148],
	],
	{ brush: 'pencil', strokeWidth: 2 },
)

curve(
	'house-walls',
	[
		[80, 220],
		[80, 320],
		[240, 320],
		[240, 220],
	],
	{ strokeWidth: 4 },
)
curve(
	'house-roof',
	[
		[64, 224],
		[160, 150],
		[256, 224],
	],
	{ brush: 'marker', strokeWidth: 8 },
)
curve(
	'house-door',
	[
		[140, 320],
		[140, 270],
		[180, 270],
		[180, 320],
	],
	{ brush: 'pencil', strokeWidth: 3 },
)
curve(
	'house-window',
	[
		[100, 245],
		[128, 245],
		[128, 273],
		[100, 273],
		[100, 245],
	],
	{
		brush: 'pencil',
		strokeWidth: 2,
	},
)
curve(
	'house-smoke',
	[
		[200, 170],
		[208, 152],
		[198, 136],
		[210, 118],
	],
	{ brush: 'brush', strokeWidth: 6 },
)

arc('sun', 360, 110, 30, 30, 0, Math.PI * 2, 36, {
	brush: 'marker',
	strokeWidth: 7,
	color: '#b45309',
})
for (const [index, angle] of [0.2, 1.1, 2.2, 3.4, 4.4, 5.4].entries()) {
	curve(
		`sun-ray-${index}`,
		[
			[360 + Math.cos(angle) * 42, 110 + Math.sin(angle) * 42],
			[360 + Math.cos(angle) * 58, 110 + Math.sin(angle) * 58],
		],
		{ brush: 'pencil', strokeWidth: 2, color: '#b45309' },
	)
}

curve(
	'hill-left',
	[
		[20, 400],
		[120, 330],
		[240, 400],
	],
	{ brush: 'marker', strokeWidth: 9, color: '#107c10' },
)
curve(
	'hill-right',
	[
		[180, 410],
		[300, 340],
		[420, 410],
	],
	{ brush: 'marker', strokeWidth: 7, color: '#107c10' },
)
curve(
	'grass-a',
	[
		[60, 360],
		[58, 344],
		[64, 356],
	],
	{ brush: 'pencil', strokeWidth: 2, color: '#107c10' },
)
curve(
	'bird-left',
	[
		[420, 150],
		[432, 140],
		[444, 150],
	],
	{ brush: 'pencil', strokeWidth: 2 },
)
curve(
	'bird-right',
	[
		[444, 150],
		[456, 140],
		[468, 150],
	],
	{ brush: 'pencil', strokeWidth: 2 },
)

const operations = [
	{
		type: 'create',
		shape: {
			id: 'sketch-title',
			type: 'text',
			x: base.x,
			y: base.y - 72,
			w: 320,
			h: 44,
			color: '#242424',
			text: 'Hand-drawn by API',
		},
	},
	...strokes.map(({ id, color, brush, strokeWidth, points }) => {
		const xs = points.map((point) => point.x)
		const ys = points.map((point) => point.y)
		const x = Math.min(...xs)
		const y = Math.min(...ys)
		const w = Math.max(...xs) - x
		const h = Math.max(...ys) - y
		return {
			type: 'create',
			shape: {
				id: `sketch-${id}`,
				type: 'path',
				x,
				y,
				w,
				h,
				color,
				brush,
				strokeWidth,
				points: points.map((point) => ({
					x: Math.min(w, Math.max(0, point.x - x)),
					y: Math.min(h, Math.max(0, point.y - y)),
				})),
			},
		}
	}),
]

console.log(JSON.stringify(operations))
