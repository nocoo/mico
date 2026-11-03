import type { Operation } from '../src/shared/types.ts'

const colors = ['#2563eb', '#7c3aed', '#0f766e', '#b45309', '#be185d']
const lanes = [
	'Clients',
	'Edge & identity',
	'Domain services',
	'Events & workers',
	'Data & telemetry',
]
const nodes: [string, string, number, number][] = [
	['web', 'Web storefront', 0, 0],
	['mobile', 'Mobile application', 0, 1],
	['partner', 'Partner integrations', 0, 2],
	['admin', 'Operations console', 0, 3],
	['gateway', 'API gateway / WAF', 1, 0],
	['auth', 'OIDC / authorization', 1, 1],
	['limits', 'Rate limits / quotas', 1, 2],
	['realtime', 'WebSocket gateway', 1, 3],
	['catalog', 'Catalog service', 2, 0],
	['orders', 'Order service', 2, 1],
	['payments', 'Payment service', 2, 2],
	['fulfillment', 'Fulfillment service', 2, 3],
	['indexer', 'Search index worker', 3, 0],
	['outbox', 'Transactional outbox', 3, 1],
	['bus', 'Kafka / event bus', 3, 2],
	['notify', 'Notification worker', 3, 3],
	['search', 'Search index / CDN', 4, 0],
	['postgres', 'PostgreSQL cluster', 4, 1],
	['redis', 'Redis / idempotency', 4, 2],
	['telemetry', 'OpenTelemetry / SLOs', 4, 3],
]
const edges = [
	['web', 'gateway'],
	['mobile', 'gateway'],
	['partner', 'limits'],
	['admin', 'auth'],
	['gateway', 'auth'],
	['limits', 'gateway'],
	['gateway', 'catalog'],
	['gateway', 'orders'],
	['auth', 'orders'],
	['auth', 'payments'],
	['orders', 'payments'],
	['orders', 'fulfillment'],
	['catalog', 'indexer'],
	['indexer', 'search'],
	['orders', 'outbox'],
	['outbox', 'postgres'],
	['outbox', 'bus'],
	['payments', 'bus'],
	['payments', 'redis'],
	['bus', 'fulfillment'],
	['bus', 'notify'],
	['bus', 'indexer'],
	['notify', 'realtime'],
	['realtime', 'mobile'],
	['fulfillment', 'notify'],
	['gateway', 'telemetry'],
	['bus', 'telemetry'],
]
const operations: Operation[] = [
	{
		type: 'create',
		shape: {
			id: 'commerce-title',
			type: 'text',
			x: 1700,
			y: 80,
			w: 1290,
			h: 48,
			color: '#172033',
			text: 'Distributed commerce platform · event-driven architecture',
		},
	},
	...lanes.map(
		(text, column): Operation => ({
			type: 'create',
			shape: {
				id: `commerce-lane-${column}`,
				type: 'text',
				x: 1700 + column * 270,
				y: 156,
				w: 210,
				h: 40,
				color: colors[column],
				text,
			},
		}),
	),
	...nodes.map(
		([id, text, column, row]): Operation => ({
			type: 'create',
			shape: {
				id: `commerce-${id}`,
				type: column === 4 ? 'ellipse' : 'rectangle',
				x: 1700 + column * 270,
				y: 240 + row * 180,
				w: 210,
				h: 80,
				color: colors[column],
				text,
			},
		}),
	),
	...edges.map(
		([from, to], index): Operation => ({
			type: 'create',
			shape: {
				id: `commerce-edge-${index}`,
				type: 'connector',
				from: `commerce-${from}`,
				to: `commerce-${to}`,
				color: '#64748b',
			},
		}),
	),
]
console.log(JSON.stringify(operations))
