export const DEV_PORT = 7063
export const DAEMON_PORT = 37063
export const DEV_HOST = 'mico.dev.hexly.ai'
export const DEV_ORIGIN = `https://${DEV_HOST}`
export const BROWSER_PORT = 27063
export const E2E_PORT = 17063
export const DOCKER_PORT = 47063

export const ALLOWED_ORIGINS = new Set([
	DEV_ORIGIN,
	...[DEV_PORT, BROWSER_PORT, E2E_PORT, DOCKER_PORT].flatMap((port) => [
		`http://127.0.0.1:${port}`,
		`http://localhost:${port}`,
	]),
])
