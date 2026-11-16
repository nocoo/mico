import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasSummary } from '../../shared/types'
import { joinWhiteboardSchema, type WhiteboardSession } from '../../shared/whiteboards'
import App, { type AppProps } from '../App'
import { clearWhiteboard, configureWhiteboard, joinWhiteboard } from './client'
import './whiteboards.css'

export function WhiteboardGate(props: AppProps) {
	const [session, setSession] = useState<WhiteboardSession | null>(null)
	const [error, setError] = useState('')
	const joinRequest = useRef<AbortController | null>(null)
	const [clientId] = useState(() => crypto.randomUUID())
	const params = new URLSearchParams(window.location.search)
	const id = params.get('whiteboardid')
	const username = params.get('username') ?? ''
	const sharer = params.get('sharer') ?? 'false'

	const load = useCallback(() => {
		if (id === null) return
		joinRequest.current?.abort()
		const controller = new AbortController()
		joinRequest.current = controller
		setError('')
		const parsed = joinWhiteboardSchema.safeParse({
			whiteboardid: id,
			username,
			sharer: sharer === 'true',
			clientId,
		})
		if (!parsed.success || !['true', 'false'].includes(sharer)) {
			setError('Provide a whiteboard ID, a name (1–80 characters), and sharer=true or false.')
			return
		}
		void joinWhiteboard(parsed.data, controller.signal)
			.then((joined) => {
				if (controller.signal.aborted) return
				configureWhiteboard(parsed.data, joined)
				setSession(joined)
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setError(cause instanceof Error ? cause.message : 'Could not join whiteboard.')
			})
	}, [id, username, sharer, clientId])
	useEffect(() => {
		load()
		return () => {
			joinRequest.current?.abort()
			clearWhiteboard()
		}
	}, [load])

	if (id === null) return <WhiteboardLobby />
	if (session) return <App {...props} whiteboard={session} />
	return (
		<main className="gate-screen">
			<section className="gate-card">
				<h1>{error ? 'Could not join whiteboard' : 'Joining whiteboard'}</h1>
				<p role={error ? 'alert' : 'status'}>{error || 'Connecting to the shared canvas…'}</p>
				{error && (
					<button type="button" className="gate-action" onClick={load}>
						Retry
					</button>
				)}
				<a href="/?whiteboards=1">Back to shared whiteboards</a>
			</section>
		</main>
	)
}

function WhiteboardLobby() {
	const [boards, setBoards] = useState<CanvasSummary[]>([])
	const [username, setUsername] = useState('')
	const [name, setName] = useState('')
	const [sharer, setSharer] = useState(false)
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const listRequest = useRef<AbortController | null>(null)
	const load = useCallback(() => {
		listRequest.current?.abort()
		const controller = new AbortController()
		listRequest.current = controller
		setLoading(true)
		void fetch('/api/whiteboards', { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error('Could not load shared whiteboards.')
				const body = (await response.json()) as { whiteboards: CanvasSummary[] }
				if (controller.signal.aborted) return
				setBoards(body.whiteboards)
				setError('')
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setError(cause instanceof Error ? cause.message : 'Could not load whiteboards.')
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false)
			})
	}, [])
	useEffect(() => {
		load()
		return () => listRequest.current?.abort()
	}, [load])

	const enter = (id: string, presenting: boolean) => {
		const query = new URLSearchParams({
			whiteboardid: id,
			username: username.trim(),
			sharer: String(presenting),
		})
		window.location.assign(`/?${query}`)
	}
	const create = async () => {
		setBusy(true)
		setError('')
		try {
			const response = await fetch('/api/whiteboards', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: name.trim() }),
				signal: AbortSignal.timeout(10000),
			})
			if (!response.ok) {
				const body = (await response.json()) as { message: string }
				throw new Error(body.message)
			}
			const body = (await response.json()) as { whiteboard: CanvasSummary }
			enter(body.whiteboard.id, true)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Could not create whiteboard.')
			setBusy(false)
		}
	}
	return (
		<main className="whiteboard-lobby">
			<header>
				<a href="/">Private workspace</a>
				<h1>Shared whiteboards</h1>
				<p>Present together. Explore at your own pace.</p>
			</header>
			<div className="whiteboard-join-options">
				<label>
					Your name
					<input
						value={username}
						maxLength={80}
						onChange={(event) => setUsername(event.target.value)}
						autoComplete="nickname"
					/>
				</label>
				<label className="whiteboard-role">
					<input
						type="checkbox"
						checked={sharer}
						onChange={(event) => setSharer(event.target.checked)}
					/>
					Join as presenter
				</label>
				<p>Trusted mode: anyone can choose the presenter role. One presenter per whiteboard.</p>
			</div>
			<form
				className="whiteboard-create"
				onSubmit={(event) => {
					event.preventDefault()
					void create()
				}}
			>
				<label>
					New whiteboard name
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						maxLength={80}
						required
					/>
				</label>
				<button type="submit" disabled={busy || !username.trim() || !name.trim()}>
					{busy ? 'Creating…' : 'Create and present'}
				</button>
			</form>
			<div className="whiteboard-list-heading">
				<h2>Available whiteboards</h2>
				<button type="button" onClick={load} disabled={loading}>
					Refresh
				</button>
			</div>
			{error && <p role="alert">{error}</p>}
			{loading ? (
				<p role="status">Loading whiteboards…</p>
			) : (
				<ul className="whiteboard-list">
					{boards.map((board) => (
						<li key={board.id}>
							<div>
								<strong>{board.name}</strong>
								<code>{board.id}</code>
							</div>
							<button
								type="button"
								disabled={!username.trim()}
								onClick={() => enter(board.id, sharer)}
							>
								Join
							</button>
						</li>
					))}
				</ul>
			)}
		</main>
	)
}
