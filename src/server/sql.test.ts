import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSqliteSql } from './sql.ts'

test('SQLite transaction rolls back reads, writes and CAS conflicts', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-sql-'))
	const dbPath = join(directory, 'board.sqlite')
	const sql = createSqliteSql(dbPath)
	try {
		await sql.exec('CREATE TABLE assets (id TEXT PRIMARY KEY, revision INTEGER)')
		await sql.run('INSERT INTO assets (id, revision) VALUES (?, ?)', ['asset', 0])
		await assert.rejects(() =>
			sql.transaction(async (tx) => {
				await tx.run('INSERT INTO assets (id, revision) VALUES (?, ?)', ['pending', 1])
				const row = await tx.get<{ revision: number }>('SELECT revision FROM assets WHERE id = ?', [
					'asset',
				])
				assert.equal(row?.revision, 0)
				const changes = await tx.run(
					'UPDATE assets SET revision = ? WHERE id = ? AND revision = ?',
					[1, 'asset', 1],
				)
				if (changes !== 1) throw new Error('revision conflict')
			}),
		)
		assert.equal(await sql.get('SELECT id FROM assets WHERE id = ?', ['pending']), undefined)
		const asset = await sql.get<{ revision: number }>('SELECT revision FROM assets WHERE id = ?', [
			'asset',
		])
		assert.equal(asset?.revision, 0)
	} finally {
		await sql.close()
		await sql.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('separate SQL handles serialize async transactions on one database', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-sql-multi-'))
	const dbPath = join(directory, 'board.sqlite')
	const first = createSqliteSql(dbPath)
	const second = createSqliteSql(dbPath)
	try {
		await first.exec('CREATE TABLE counters (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)')
		await first.run('INSERT INTO counters (id, value) VALUES (1, 0)')

		const increment = (sql: typeof first) =>
			sql.transaction(async (tx) => {
				const row = await tx.get<{ value: number }>('SELECT value FROM counters WHERE id = 1')
				await new Promise((resolve) => setTimeout(resolve, 5))
				await tx.run('UPDATE counters SET value = ? WHERE id = 1', [(row?.value ?? 0) + 1])
			})

		await Promise.all([increment(first), increment(second)])
		const counter = await first.get<{ value: number }>('SELECT value FROM counters WHERE id = 1')
		assert.equal(counter?.value, 2)
	} finally {
		await Promise.all([first.close(), second.close(), first.close(), second.close()])
		rmSync(directory, { recursive: true, force: true })
	}
})
