import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const resolveFromProject = createRequire(import.meta.url)

test('react renderer and UI dependencies resolve the same React instance', () => {
	const reactPath = realpathSync(resolveFromProject.resolve('react'))
	for (const name of ['react-dom/client', '@radix-ui/themes', 'lucide-react', '@ai-sdk/react']) {
		const resolveFromDependency = createRequire(resolveFromProject.resolve(name))
		assert.equal(
			realpathSync(resolveFromDependency.resolve('react')),
			reactPath,
			`${name} must use the project React instance`,
		)
	}
})
