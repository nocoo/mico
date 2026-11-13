import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const prePush = fileURLToPath(new URL('../.githooks/pre-push', import.meta.url))

test('pre-push builds the exact worktree without relinking shared dependencies', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-hook-test-'))
	const repo = join(directory, 'repo')
	const bin = join(directory, 'bin')
	const log = join(directory, 'commands.log')
	const env = { ...process.env }
	for (const key of Object.keys(env)) {
		if (key.startsWith('GIT_')) delete env[key]
	}
	env.GIT_CONFIG_GLOBAL = '/dev/null'
	env.GIT_CONFIG_NOSYSTEM = '1'
	env.PATH = `${bin}:${process.env.PATH}`
	env.MICO_HOOK_LOG = log
	mkdirSync(join(repo, 'scripts'), { recursive: true })
	mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true })
	mkdirSync(join(repo, 'node_modules', '.store'), { recursive: true })
	mkdirSync(join(repo, 'node_modules', '.pnpm'), { recursive: true })
	mkdirSync(bin)
	try {
		writeFileSync(join(repo, 'pnpm-lock.yaml'), 'old-lock\n')
		writeFileSync(join(repo, 'node_modules', '.pnpm', 'lock.yaml'), 'old-lock\n')
		writeFileSync(join(repo, 'revision.txt'), 'old\n')
		writeFileSync(
			join(repo, 'scripts', 'run-tests.ts'),
			"import { appendFileSync, readFileSync } from 'node:fs'; appendFileSync(process.env.MICO_HOOK_LOG, 'tests ' + readFileSync('revision.txt', 'utf8').trim() + ' ' + process.argv[2] + '\\n'); if (process.env.MICO_HOOK_FAIL === 'integration') process.exit(1)",
		)
		for (const name of ['tsc', 'vite']) {
			writeFileSync(
				join(repo, 'node_modules', '.bin', name),
				`#!/bin/sh\nIFS= read -r revision < revision.txt\nprintf '%s %s %s\\n' '${name}' "$revision" "$*" >> "$MICO_HOOK_LOG"\n[ "$MICO_HOOK_FAIL" != '${name}' ]\n`,
				{ mode: 0o755 },
			)
		}
		writeFileSync(join(repo, 'node_modules', '.store', 'dependency'), 'present')
		symlinkSync('.store/dependency', join(repo, 'node_modules', 'dependency'))
		writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 99\n', { mode: 0o755 })
		writeFileSync(
			join(bin, 'osv-scanner'),
			'#!/bin/sh\nfor arg in "$@"; do case "$arg" in --lockfile=*) file=$(printf \'%s\' "$arg" | cut -c12-) ;; esac; done\nIFS= read -r lock < "$file"\nprintf \'osv %s\\n\' "$lock" >> "$MICO_HOOK_LOG"\n[ "$MICO_HOOK_FAIL" != osv ]\n',
			{ mode: 0o755 },
		)
		const git = (...args: string[]) =>
			execFileSync('git', args, { cwd: repo, encoding: 'utf8', env })
		git('init', '-q')
		git('add', 'pnpm-lock.yaml', 'revision.txt', 'scripts/run-tests.ts')
		git(
			'-c',
			'core.hooksPath=/dev/null',
			'-c',
			'commit.gpgsign=false',
			'-c',
			'user.name=Test',
			'-c',
			'user.email=test@example.invalid',
			'commit',
			'-qm',
			'fixture',
		)
		const oid = git('rev-parse', 'HEAD').trim()
		writeFileSync(join(repo, 'pnpm-lock.yaml'), 'new-lock\n')
		writeFileSync(join(repo, 'revision.txt'), 'new\n')
		git('add', 'pnpm-lock.yaml', 'revision.txt')
		git(
			'-c',
			'core.hooksPath=/dev/null',
			'-c',
			'commit.gpgsign=false',
			'-c',
			'user.name=Test',
			'-c',
			'user.email=test@example.invalid',
			'commit',
			'-qm',
			'next revision',
		)
		writeFileSync(join(repo, 'revision.txt'), 'dirty\n')
		const input = `refs/heads/main ${oid} refs/heads/main ${'0'.repeat(40)}\n`
		const hook = (failure?: string) =>
			spawnSync('sh', [prePush], {
				cwd: repo,
				input,
				encoding: 'utf8',
				env: { ...env, ...(failure ? { MICO_HOOK_FAIL: failure } : {}) },
			})
		const success = hook()
		assert.equal(success.status, 0, success.stderr)
		assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
			'tsc old --noEmit',
			'vite old build',
			'tests old integration',
			'osv old-lock',
		])
		assert.equal(readlinkSync(join(repo, 'node_modules', 'dependency')), '.store/dependency')
		assert.equal(readFileSync(join(repo, 'node_modules', 'dependency'), 'utf8'), 'present')
		for (const failure of ['tsc', 'vite', 'integration', 'osv']) {
			const rejected = hook(failure)
			assert.notEqual(rejected.status, 0, `${failure} must block the push`)
		}
		writeFileSync(log, '')
		writeFileSync(join(repo, 'node_modules', '.pnpm', 'lock.yaml'), 'new-lock\n')
		const mismatch = hook()
		assert.notEqual(mismatch.status, 0)
		assert.match(mismatch.stderr, /installed dependencies do not match/)
		assert.equal(readFileSync(log, 'utf8').trim(), 'osv old-lock')
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
