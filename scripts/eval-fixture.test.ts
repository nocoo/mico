import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import type { Page } from '@playwright/test'
import type { Board, CanvasShape } from '../src/shared/types.ts'
import {
	assertBoardRenderable,
	assertStableCapture,
	captureFailure,
	validateCaptureRunDirectory,
} from './eval-capture.ts'
import { prepareEvalDbPath, validateEvalDbPath } from './eval-server.ts'

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
			screenshot: async (options: { path: string }) => {
				writeFileSync(options.path, 'png')
			},
		} as unknown as Page
		await captureFailure(directory, fakePage, new Error('empty eval board'))
		assert.equal(existsSync(join(directory, 'board.json')), true)
		assert.equal(existsSync(join(directory, 'screenshot.png')), true)
		assert.equal(existsSync(join(directory, 'failure.json')), true)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('eval capture requires stable revision, board shapes and DOM count', () => {
	const snapshot: Board = { revision: 7, shapes: [shape] }
	assert.doesNotThrow(() => assertStableCapture(snapshot, snapshot, 1))
	assert.throws(
		() => assertStableCapture(snapshot, { revision: 8, shapes: [shape] }, 1),
		/revision changed/,
	)
	assert.throws(
		() => assertStableCapture(snapshot, { revision: 7, shapes: [] }, 1),
		/Board shapes changed/,
	)
	assert.throws(() => assertStableCapture(snapshot, snapshot, 0), /Rendered shape count mismatch/)
})
