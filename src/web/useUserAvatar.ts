import { useEffect, useState } from 'react'
import type { PublicRuntimeContract } from '../shared/runtime.ts'
import { fetchUserAvatar } from './avatar.ts'
import { getMsal } from './msal.ts'
import type { ServerSession } from './runtime.ts'

export function useUserAvatar(
	auth: PublicRuntimeContract['auth'] | undefined,
	user: ServerSession['user'],
): string | null {
	const [avatar, setAvatar] = useState<{ user: ServerSession['user']; url: string } | null>(null)

	useEffect(() => {
		if (auth?.mode !== 'entra' || !user) return
		const controller = new AbortController()
		let objectUrl: string | undefined
		void getMsal(auth)
			.then((msal) => fetchUserAvatar(msal, controller.signal))
			.then((photo) => {
				if (!photo || controller.signal.aborted) return
				objectUrl = URL.createObjectURL(photo)
				setAvatar({ user, url: objectUrl })
			})
			.catch(() => undefined)
		return () => {
			controller.abort()
			if (objectUrl) URL.revokeObjectURL(objectUrl)
		}
	}, [auth, user])

	return auth?.mode === 'entra' && user && avatar?.user === user ? avatar.url : null
}
