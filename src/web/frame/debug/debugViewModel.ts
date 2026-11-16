export interface DebugUser {
	name: string
	expiresAt: number
}

export interface DebugViewModelInput {
	user: DebugUser | null
	avatarUrl: string | null
	ephemeral: boolean
	aiEnabled: boolean
	version: string
	hasSignOut: boolean
}

export interface DebugViewModel {
	user: DebugUser | null
	avatarUrl: string | null
	avatarFallback: string | null
	preview: boolean
	aiEnabled: boolean
	version: string
	hasSignOut: boolean
}

export function shouldShowDebug(
	input: Pick<DebugViewModelInput, 'ephemeral' | 'user' | 'aiEnabled'>,
) {
	return input.ephemeral || input.user !== null || !input.aiEnabled
}

export function createDebugViewModel(input: DebugViewModelInput): DebugViewModel {
	const firstCharacter = input.user?.name.trim().codePointAt(0)

	return {
		user: input.user,
		avatarUrl: input.avatarUrl?.trim() || null,
		avatarFallback: firstCharacter
			? String.fromCodePoint(firstCharacter).toLocaleUpperCase()
			: null,
		preview: input.ephemeral,
		aiEnabled: input.aiEnabled,
		version: input.version,
		hasSignOut: Boolean(input.user && input.hasSignOut),
	}
}
