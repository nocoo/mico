import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const INTEGRATION = [
	'src/cli/index.test.ts',
	'src/server/ai.test.ts',
	'src/server/aiConfig.integration.test.ts',
	'src/server/api.test.ts',
	'src/server/auth.integration.test.ts',
	'src/server/imageGeneration.test.ts',
	'src/server/index.test.ts',
	'src/server/managedIdentity.integration.test.ts',
	'src/server/moss.test.ts',
	'src/server/production.test.ts',
	'src/server/realtimeProxy.test.ts',
	'scripts/examples.test.ts',
]

function discover(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name)
		if (entry.isDirectory()) return discover(path)
		return entry.name.endsWith('.test.ts') ? [path] : []
	})
}

const selection = process.argv[2] ?? 'all'
if (!['unit', 'integration', 'all'].includes(selection)) {
	console.error(`Unknown test selection: ${selection}`)
	process.exit(1)
}

const all = ['src', 'scripts'].flatMap(discover).sort()
const integration = new Set(INTEGRATION)
const absent = INTEGRATION.filter((file) => !all.includes(file))
if (absent.length > 0) {
	console.error(`Integration test files are missing:\n${absent.join('\n')}`)
	process.exit(1)
}

const files =
	selection === 'unit'
		? all.filter((file) => !integration.has(file))
		: selection === 'integration'
			? [...INTEGRATION].sort()
			: all

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
