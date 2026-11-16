import { fileURLToPath } from 'node:url'

export async function createSharedWhiteboard(
	baseUrl: string,
	name: string,
	username: string,
	origin = new URL(baseUrl).origin,
) {
	const headers = { origin, 'Content-Type': 'application/json' }
	const existing = await fetch(new URL('/api/whiteboards', baseUrl), { headers })
	if (!existing.ok) throw new Error(`List failed: HTTP ${existing.status}`)
	const list = await existing.json()
	const response = await fetch(new URL('/api/whiteboards', baseUrl), {
		method: 'POST',
		headers,
		body: JSON.stringify({ name }),
	})
	if (!response.ok)
		throw new Error(`Create failed: HTTP ${response.status}: ${await response.text()}`)
	const { whiteboard } = (await response.json()) as { whiteboard: { id: string } }
	const url = new URL('/', baseUrl)
	url.search = new URLSearchParams({
		whiteboardid: whiteboard.id,
		username,
		sharer: 'true',
	}).toString()
	return { existing: list, whiteboardid: whiteboard.id, presenterUrl: url.href }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [baseUrl, name, username] = process.argv.slice(2)
	if (!baseUrl || !name || !username)
		throw new Error(
			'Usage: node examples/shared-whiteboard.ts <UI origin> <whiteboard name> <your name>',
		)
	console.log(JSON.stringify(await createSharedWhiteboard(baseUrl, name, username), null, 2))
}
