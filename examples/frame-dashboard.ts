import type { Operation } from '../src/shared/types.ts'

const markup = `<!doctype html>
<html>
<head>
<style>
  body { margin: 0; padding: 16px; font-family: Inter, system-ui, sans-serif; color: #172033; }
  h2 { margin: 0 0 12px; font-size: 15px; }
  .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 12px; }
  .bar { height: 10px; border-radius: 4px; background: #3b82f6; }
  .value { margin-left: auto; color: #5b6575; }
</style>
</head>
<body>
  <h2>Weekly active agents</h2>
  <div class="row"><span>Mon</span><div class="bar" style="width: 62%"></div><span class="value">31</span></div>
  <div class="row"><span>Tue</span><div class="bar" style="width: 84%"></div><span class="value">42</span></div>
  <div class="row"><span>Wed</span><div class="bar" style="width: 74%"></div><span class="value">37</span></div>
  <div class="row"><span>Thu</span><div class="bar" style="width: 100%"></div><span class="value">50</span></div>
</body>
</html>`

const operations: Operation[] = [
	{
		type: 'create',
		shape: {
			id: 'dashboard-frame-a',
			type: 'frame',
			x: 1200,
			y: 100,
			w: 600,
			h: 420,
			color: '#3b82f6',
			title: 'Agent dashboard',
		},
	},
	{
		type: 'create',
		shape: {
			id: 'dashboard-frame-b',
			type: 'frame',
			x: 1950,
			y: 100,
			w: 420,
			h: 260,
			color: '#22c55e',
			title: 'Source data',
		},
	},
	{
		type: 'create',
		shape: {
			id: 'dashboard-title',
			type: 'text',
			x: 1240,
			y: 170,
			w: 420,
			h: 48,
			color: '#1d4ed8',
			text: 'This week',
			font: 'sans',
			fontSize: 32,
			fontWeight: 700,
			frameId: 'dashboard-frame-a',
		},
	},
	{
		type: 'create',
		shape: {
			id: 'dashboard-summary',
			type: 'rectangle',
			x: 1240,
			y: 260,
			w: 220,
			h: 80,
			color: '#22c55e',
			text: '50 runs',
			frameId: 'dashboard-frame-a',
		},
	},
	{
		type: 'create',
		shape: {
			id: 'dashboard-note',
			type: 'note',
			x: 1240,
			y: 380,
			w: 140,
			h: 120,
			color: '#fef3c7',
			text: 'Review on Monday',
			frameId: 'dashboard-frame-a',
		},
	},
	{
		type: 'create',
		shape: {
			id: 'dashboard-html',
			type: 'html',
			x: 1500,
			y: 250,
			w: 280,
			h: 220,
			color: '#3b82f6',
			title: 'Generated chart',
			html: markup,
			frameId: 'dashboard-frame-a',
		},
	},
	{
		type: 'create',
		shape: {
			id: 'dashboard-frame-edge',
			type: 'connector',
			from: 'dashboard-frame-a',
			to: 'dashboard-frame-b',
			fromAnchor: 3,
			toAnchor: 9,
			color: '#5c6474',
		},
	},
	{
		type: 'create',
		shape: {
			id: 'dashboard-element-edge',
			type: 'connector',
			from: 'dashboard-summary',
			to: 'dashboard-note',
			color: '#5c6474',
		},
	},
]

console.log(JSON.stringify(operations))
