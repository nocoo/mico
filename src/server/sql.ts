import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type SqlValue = string | number | Uint8Array | null

export interface SqlStatement {
	readonly sql: string
	readonly params?: readonly SqlValue[]
}

export interface Sql {
	exec(sql: string): Promise<void>
	get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>
	all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
	run(sql: string, params?: readonly SqlValue[]): Promise<number>
	batch(statements: readonly SqlStatement[]): Promise<number[]>
	hasTable(name: string): Promise<boolean>
	close(): Promise<void>
}

export function createSqliteSql(dbPath: string): Sql {
	const path = resolve(dbPath)
	mkdirSync(dirname(path), { recursive: true })
	const db = new DatabaseSync(path, { timeout: 1000 })

	const run = (statement: SqlStatement): number =>
		Number(db.prepare(statement.sql).run(...(statement.params ?? [])).changes)

	return {
		async exec(sql) {
			db.exec(sql)
		},
		async get<T>(sql: string, params: readonly SqlValue[] = []) {
			return db.prepare(sql).get(...params) as T | undefined
		},
		async all<T>(sql: string, params: readonly SqlValue[] = []) {
			return db.prepare(sql).all(...params) as T[]
		},
		async run(sql: string, params: readonly SqlValue[] = []) {
			return Number(db.prepare(sql).run(...params).changes)
		},
		async batch(statements) {
			db.exec('BEGIN IMMEDIATE')
			try {
				const changes = statements.map(run)
				db.exec('COMMIT')
				return changes
			} catch (error) {
				db.exec('ROLLBACK')
				throw error
			}
		},
		async hasTable(name: string) {
			const row = db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
				.get(name)
			return row !== undefined
		},
		async close() {
			db.close()
		},
	}
}

export function createMutex(): <T>(operation: () => Promise<T>) => Promise<T> {
	let tail = Promise.resolve()
	return <T>(operation: () => Promise<T>) => {
		const result = tail.then(operation)
		tail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
}
