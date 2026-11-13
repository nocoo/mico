import { useEffect, useState } from 'react'
import App from './App'
import { clearMsalCache, completeCallback, loginWithMsal } from './msal'
import {
	expiresAtMilliseconds,
	fetchRuntime,
	fetchSession,
	type RuntimeConfig,
	type ServerSession,
	sessionExpired,
} from './runtime'

function GateScreen({
	title,
	message,
	action,
}: {
	title: string
	message: string
	action?: { label: string; onClick: () => void }
}) {
	return (
		<main className="gate-screen">
			<section className="gate-card">
				<div className="gate-brand">Mico</div>
				<h1>{title}</h1>
				<p>{message}</p>
				{action && (
					<button type="button" className="gate-action" onClick={action.onClick}>
						{action.label}
					</button>
				)}
			</section>
		</main>
	)
}

function LoginView({ runtime }: { runtime: RuntimeConfig }) {
	const [error, setError] = useState('')
	const [signingIn, setSigningIn] = useState(false)

	useEffect(() => {
		if (runtime.auth.mode === 'none') {
			window.location.replace('/')
			return
		}
		void fetchSession()
			.then((session) => {
				if (session.user && !sessionExpired(session)) window.location.replace('/')
			})
			.catch(() => undefined)
	}, [runtime])

	const signIn = () => {
		setSigningIn(true)
		setError('')
		void loginWithMsal(runtime.auth).catch((cause: unknown) => {
			setSigningIn(false)
			setError(cause instanceof Error ? cause.message : 'Microsoft sign-in could not start.')
		})
	}

	return (
		<GateScreen
			title="Sign in to Mico"
			message={`${error ? `${error} ` : ''}Use your Microsoft account to open this Mico workspace.`}
			action={{
				label: signingIn ? 'Opening Microsoft…' : 'Sign in with Microsoft',
				onClick: signIn,
			}}
		/>
	)
}

function CallbackView({ runtime }: { runtime: RuntimeConfig }) {
	const [error, setError] = useState('')
	const [retrying, setRetrying] = useState(false)

	useEffect(() => {
		if (runtime.auth.mode === 'none') {
			window.location.replace('/')
			return
		}
		void completeCallback(runtime.auth)
			.then(() => {
				window.location.replace('/')
			})
			.catch((cause: unknown) => {
				setError(
					cause instanceof Error ? cause.message : 'Microsoft sign-in could not be completed.',
				)
			})
	}, [runtime])

	const retry = () => {
		setRetrying(true)
		setError('')
		void clearMsalCache(runtime.auth)
			.catch(() => undefined)
			.finally(() => {
				window.history.replaceState(null, '', '/login')
				void loginWithMsal(runtime.auth).catch((cause: unknown) => {
					setRetrying(false)
					setError(cause instanceof Error ? cause.message : 'Microsoft sign-in could not start.')
				})
			})
	}

	return error ? (
		<GateScreen
			title="Could not finish sign-in"
			message={error}
			action={{
				label: retrying ? 'Opening Microsoft…' : 'Try Microsoft sign-in again',
				onClick: retry,
			}}
		/>
	) : (
		<GateScreen title="Completing sign-in" message="Verifying your Microsoft account…" />
	)
}

export default function BootGate() {
	const [runtime, setRuntime] = useState<RuntimeConfig | null>(null)
	const [session, setSession] = useState<ServerSession | null>(null)
	const [loading, setLoading] = useState(true)
	const [runtimeError, setRuntimeError] = useState(false)
	const [loginRequired, setLoginRequired] = useState(false)
	const [loggingOut, setLoggingOut] = useState(false)
	const [logoutError, setLogoutError] = useState('')

	const load = () => {
		setLoading(true)
		setRuntimeError(false)
		setLoginRequired(false)
		setSession(null)
		void fetchRuntime()
			.then(async (nextRuntime) => {
				setRuntime(nextRuntime)
				if (window.location.pathname === '/login') {
					setLoading(false)
					return
				}
				if (window.location.pathname === '/auth/callback') {
					setLoading(false)
					return
				}
				if (nextRuntime.auth.mode === 'none') {
					setSession({ user: null })
					setLoading(false)
					return
				}
				try {
					const nextSession = await fetchSession()
					if (!nextSession.user || sessionExpired(nextSession)) {
						setLoginRequired(true)
						setLoading(false)
						return
					}
					setSession(nextSession)
					setLoading(false)
				} catch {
					setLoginRequired(true)
					setLoading(false)
				}
			})
			.catch(() => {
				setLoading(false)
				setRuntimeError(true)
			})
	}

	useEffect(load, [])

	useEffect(() => {
		if (!session?.user || !runtime || runtime.auth.mode === 'none') return
		const expiresAt = expiresAtMilliseconds(session.user.expiresAt)
		const check = () => {
			if (Date.now() >= expiresAt) {
				setSession(null)
				setLoginRequired(true)
			}
		}
		check()
		const timer = window.setInterval(check, 1000)
		window.addEventListener('focus', check)
		return () => {
			window.clearInterval(timer)
			window.removeEventListener('focus', check)
		}
	}, [runtime, session])

	const signOut = () => {
		if (!runtime) return
		setLoggingOut(true)
		setLogoutError('')
		setSession(null)
		setLoginRequired(false)
		void (async () => {
			try {
				const response = await fetch('/api/auth/logout', {
					method: 'POST',
					credentials: 'same-origin',
				})
				if (response.status !== 204) {
					throw new Error(
						response.status >= 500
							? 'Sign-out is temporarily unavailable. Please try again.'
							: 'The workspace could not confirm sign-out. Please try again.',
					)
				}
				if (runtime.auth.mode === 'entra') {
					await clearMsalCache(runtime.auth)
				}
				window.location.assign('/login')
			} catch (cause) {
				setLoggingOut(false)
				setLogoutError(cause instanceof Error ? cause.message : 'Sign-out could not be completed.')
			}
		})()
	}

	if (loggingOut) return <GateScreen title="Signing out" message="Closing the workspace session…" />
	if (logoutError) {
		return (
			<GateScreen
				title="Could not sign out"
				message={logoutError}
				action={{ label: 'Try sign-out again', onClick: signOut }}
			/>
		)
	}
	if (loading) return <GateScreen title="Opening Mico" message="Loading workspace settings…" />
	if (runtimeError) {
		return (
			<GateScreen
				title="Mico could not start"
				message="Workspace configuration is unavailable. The canvas is closed for safety."
				action={{ label: 'Retry', onClick: load }}
			/>
		)
	}
	if (!runtime) return null
	if (window.location.pathname === '/login' || loginRequired) {
		return <LoginView runtime={runtime} />
	}
	if (window.location.pathname === '/auth/callback') {
		return <CallbackView runtime={runtime} />
	}
	if (runtime.auth.mode === 'entra' && (!session?.user || sessionExpired(session))) {
		return <LoginView runtime={runtime} />
	}
	return (
		<App
			aiEnabled={runtime.aiEnabled}
			ephemeral={runtime.ephemeral}
			user={session?.user ?? null}
			onSignOut={signOut}
		/>
	)
}
