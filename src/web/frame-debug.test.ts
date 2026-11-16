import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDebugViewModel, shouldShowDebug } from './frame/debug/debugViewModel.ts'

const user = { name: 'Ada Lovelace', expiresAt: 1_800_000_000_000 }

const modelInput = {
	user,
	avatarUrl: ' blob:avatar ',
	ephemeral: true,
	aiEnabled: false,
	version: '0.6.5',
	hasSignOut: true,
}

test('debug entry preserves the local reference geometry unless workspace state needs it', () => {
	assert.equal(shouldShowDebug({ ephemeral: false, user: null, aiEnabled: true }), false)
	assert.equal(shouldShowDebug({ ephemeral: true, user: null, aiEnabled: true }), true)
	assert.equal(shouldShowDebug({ ephemeral: false, user, aiEnabled: true }), true)
	assert.equal(shouldShowDebug({ ephemeral: false, user: null, aiEnabled: false }), true)
})

test('debug view model exposes only supplied identity, preview, AI, version, and sign-out state', () => {
	assert.deepEqual(createDebugViewModel(modelInput), {
		user,
		avatarUrl: 'blob:avatar',
		avatarFallback: 'A',
		preview: true,
		aiEnabled: false,
		version: '0.6.5',
		hasSignOut: true,
	})
	assert.deepEqual(
		createDebugViewModel({
			...modelInput,
			user: null,
			avatarUrl: null,
			hasSignOut: true,
		}),
		{
			user: null,
			avatarUrl: null,
			avatarFallback: null,
			preview: true,
			aiEnabled: false,
			version: '0.6.5',
			hasSignOut: false,
		},
	)
})
