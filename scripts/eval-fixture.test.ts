import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import type { Page } from '@playwright/test'
import type { Board, CanvasShape } from '../src/shared/types.ts'
import {
	acquireCaptureLock,
	assertAppliedRevision,
	assertBoardRenderable,
	assertEvalIdentity,
	assertStableCapture,
	captureFailure,
	releaseCaptureLock,
	validateCaptureIdentity,
	validateCaptureRunDirectory,
} from './eval-capture.ts'
import { prepareEvalDbPath, resolveEvalIdentity, validateEvalDbPath } from './eval-server.ts'

const shape: CanvasShape = {
	id: 'node',
	type: 'rectangle',
	x: 10,
	y: 20,
	w: 100,
	h: 50,
	color: '#123456',
	text: 'Node',
}

test('eval database path requires a fresh private owned directory under tmp', () => {
	assert.throws(() => validateEvalDbPath(undefined), /Usage:/)
	assert.throws(() => validateEvalDbPath('/workspace/eval.sqlite'), /under \/tmp/)
	assert.throws(() => validateEvalDbPath('/tmp/../workspace/eval.sqlite'), /under \/tmp/)

	const directory = mkdtempSync('/tmp/mico-eval-path-')
	try {
		const dbPath = join(directory, 'board.sqlite')
		assert.equal(validateEvalDbPath(dbPath), dbPath)
		assert.equal(prepareEvalDbPath(dbPath), dbPath)
		assert.throws(() => validateEvalDbPath(dbPath), /already exists/)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('eval database path rejects symlinks and non-fresh parents', () => {
	const directory = mkdtempSync('/tmp/mico-eval-safety-')
	try {
		const link = join(directory, 'escape')
		symlinkSync('/tmp', link)
		assert.throws(() => validateEvalDbPath(join(link, 'board.sqlite')), /symlink/)

		const nested = mkdtempSync('/tmp/mico-eval-nested-')
		try {
			writeFileSync(join(nested, 'existing'), '')
			assert.throws(() => validateEvalDbPath(join(nested, 'board.sqlite')), /not fresh/)
		} finally {
			rmSync(nested, { recursive: true, force: true })
		}
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('eval database path rejects a symlink database', () => {
	const directory = mkdtempSync('/tmp/mico-eval-db-link-')
	try {
		const target = join(directory, 'target.sqlite')
		writeFileSync(target, '')
		const dbPath = join(directory, 'board.sqlite')
		symlinkSync(target, dbPath)
		assert.throws(() => validateEvalDbPath(dbPath), /symlink|already exists/)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('eval capture rejects empty boards and existing file run paths', () => {
	assert.throws(
		() => assertBoardRenderable({ revision: 1, shapes: [] } as Board),
		/Board has no shapes; refusing capture success/,
	)

	const directory = mkdtempSync('/tmp/mico-eval-run-')
	try {
		const filePath = join(directory, 'not-a-directory')
		writeFileSync(filePath, '')
		assert.throws(() => validateCaptureRunDirectory(filePath), /not a directory/)
		assert.equal(
			validateCaptureRunDirectory(join(directory, 'new-run')),
			join(directory, 'new-run'),
		)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('eval capture failure retains board and screenshot artifacts', async () => {
	const directory = mkdtempSync('/tmp/mico-eval-failure-')
	try {
		const board: Board = { revision: 3, shapes: [] }
		const fakePage = {
			request: {
				get: async () => ({ ok: () => true, json: async () => board }),
			},
			screenshot: async () => Buffer.from('png'),
		} as unknown as Page
		await captureFailure(directory, fakePage, new Error('empty eval board'))
		assert.equal(existsSync(join(directory, 'board.json')), true)
		assert.equal(existsSync(join(directory, 'screenshot.png')), true)
		assert.equal(existsSync(join(directory, 'failure.json')), true)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('eval fixture identity is per-run and exact when supplied', () => {
	assert.throws(() => validateCaptureIdentity(undefined), /Usage:/)
	assert.equal(validateCaptureIdentity('run-alpha'), 'run-alpha')
	assert.throws(() => validateCaptureIdentity('bad id'), /identity must contain/)
	assert.doesNotThrow(() => assertEvalIdentity('run-alpha', 'run-alpha'))
	assert.throws(() => assertEvalIdentity('run-alpha', 'run-beta'), /identity mismatch/)
	assert.equal(resolveEvalIdentity('run-alpha'), 'run-alpha')
	assert.match(resolveEvalIdentity(undefined), /^[a-zA-Z0-9-]+$/)
	assert.throws(() => resolveEvalIdentity('bad id'), /identity must contain/)
})

test('eval capture refuses preexisting artifacts and concurrent captures', () => {
	const directory = mkdtempSync('/tmp/mico-eval-output-')
	try {
		writeFileSync(join(directory, 'board.json'), '{}')
		assert.throws(
			() => validateCaptureRunDirectory(directory),
			/already contains output artifact: board\.json/,
		)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}

	const run = mkdtempSync('/tmp/mico-eval-lock-')
	try {
		validateCaptureRunDirectory(run)
		const lock = acquireCaptureLock(run)
		assert.throws(() => acquireCaptureLock(run), /already in progress/)
		releaseCaptureLock(lock)
		assert.doesNotThrow(() => releaseCaptureLock(acquireCaptureLock(run)))
	} finally {
		rmSync(run, { recursive: true, force: true })
	}
})

test('eval capture requires stable revision, board shapes and DOM count', () => {
	const snapshot: Board = { revision: 7, shapes: [shape] }
	assert.doesNotThrow(() => assertStableCapture(snapshot, snapshot, 1, 7))
	assert.doesNotThrow(() => assertAppliedRevision('Revision 7 · 1 objects', 7))
	assert.throws(
		() => assertStableCapture(snapshot, { revision: 8, shapes: [shape] }, 1),
		/revision changed/,
	)
	assert.throws(
		() => assertStableCapture(snapshot, { revision: 7, shapes: [] }, 1),
		/Board shapes changed/,
	)
	assert.throws(() => assertStableCapture(snapshot, snapshot, 0), /Rendered shape count mismatch/)
	assert.throws(
		() => assertStableCapture(snapshot, snapshot, 1, 8),
		/Page applied revision mismatch/,
	)
	assert.throws(
		() => assertAppliedRevision('Revision 8 · 1 objects', 7),
		/Page applied board revision mismatch/,
	)
})
