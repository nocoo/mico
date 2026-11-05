export interface ConnectionState {
	apiConnected: boolean
	wsConnected: boolean
	revision: number
	objectCount: number
}

export function deriveConnectionStatus(state: ConnectionState) {
	const status = !state.apiConnected ? 'offline' : state.wsConnected ? 'live' : 'reconnecting'
	const label = !state.apiConnected ? 'Offline' : state.wsConnected ? 'Live' : 'Reconnecting'
	return {
		status,
		label,
		title: `Revision ${state.revision} · ${state.objectCount} objects · ${label}`,
	}
}
