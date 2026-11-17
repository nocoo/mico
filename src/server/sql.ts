import { mkdirSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type SqlValue = string | number | Uint8Array | null

export type SqlDialect = 'sqlite' | 'postgres' | 'd1'

export interface SqlTransaction {
	exec(sql: string): Promise<void>
	get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>
	all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
	run(sql: string, params?: readonly SqlValue[]): Promise<number>
	hasTable(name: string): Promise<boolean>
}

export interface Sql extends SqlTransaction {
	readonly dialect: SqlDialect
	readonly concurrent?: boolean
	transaction<T>(operation: (tx: SqlTransaction) => Promise<T>): Promise<T>
	close(): Promise<void>
}

interface SqliteLock {
	readonly serialize: <T>(operation: () => Promise<T>) => Promise<T>
	refs: number
}

const sqliteLocks = new Map<string, SqliteLock>()

export function createSqliteSql(dbPath: string): Sql {
	const path = resolve(dbPath)
	mkdirSync(dirname(path), { recursive: true })
	const db = new DatabaseSync(path, { timeout: 1000 })
	let lockKey: string
	try {
		lockKey = realpathSync(path)
	} catch (error) {
		db.close()
		throw error
	}
	let lock = sqliteLocks.get(lockKey)
	if (!lock) {
		lock = { serialize: createMutex(), refs: 0 }
		sqliteLocks.set(lockKey, lock)
	}
	lock.refs += 1
	const serialize = lock.serialize
	let closed = false
	let closePromise: Promise<void> | undefined
	const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>()

	const prepare = (sql: string) => {
		let statement = statements.get(sql)
		if (!statement) {
			statement = db.prepare(sql)
			statements.set(sql, statement)
		}
		return statement
	}

	const directExec = (sql: string): Promise<void> => {
		if (closed) return Promise.reject(new Error('SQL driver is closed'))
		db.exec(sql)
		return Promise.resolve()
	}
	const directGet = <T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> => {
		if (closed) return Promise.reject(new Error('SQL driver is closed'))
		return Promise.resolve(prepare(sql).get(...params) as T | undefined)
	}
	const directAll = <T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> => {
		if (closed) return Promise.reject(new Error('SQL driver is closed'))
		return Promise.resolve(prepare(sql).all(...params) as T[])
	}
	const directRun = (sql: string, params: readonly SqlValue[] = []): Promise<number> => {
		if (closed) return Promise.reject(new Error('SQL driver is closed'))
		return Promise.resolve(Number(prepare(sql).run(...params).changes))
	}
	const directHasTable = (name: string): Promise<boolean> => {
		if (closed) return Promise.reject(new Error('SQL driver is closed'))
		const row = prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(
			name,
		)
		return Promise.resolve(row !== undefined)
	}

	const transactionSql: SqlTransaction = {
		exec: directExec,
		get: directGet,
		all: directAll,
		run: directRun,
		hasTable: directHasTable,
	}

	const close = (): Promise<void> => {
		if (!closePromise) {
			closePromise = serialize(async () => {
				if (closed) return
				closed = true
				try {
					statements.clear()
					db.close()
				} finally {
					lock.refs -= 1
					if (lock.refs === 0 && sqliteLocks.get(lockKey) === lock) sqliteLocks.delete(lockKey)
				}
			})
		}
		return closePromise
	}

	return {
		dialect: 'sqlite',
		concurrent: false,
		async exec(sql) {
			await serialize(() => directExec(sql))
		},
		async get<T>(sql: string, params: readonly SqlValue[] = []) {
			return serialize(() => directGet<T>(sql, params))
		},
		async all<T>(sql: string, params: readonly SqlValue[] = []) {
			return serialize(() => directAll<T>(sql, params))
		},
		async run(sql: string, params: readonly SqlValue[] = []) {
			return serialize(() => directRun(sql, params))
		},
		async transaction<T>(operation: (tx: SqlTransaction) => Promise<T>) {
			return serialize(async () => {
				if (closed) throw new Error('SQL driver is closed')
				db.exec('BEGIN IMMEDIATE')
				try {
					const result = await operation(transactionSql)
					db.exec('COMMIT')
					return result
				} catch (error) {
					db.exec('ROLLBACK')
					throw error
				}
			})
		},
		async hasTable(name: string) {
			return serialize(() => directHasTable(name))
		},
		close,
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

/** Rewrite unquoted `?` placeholders into `$1, $2, ...` for PostgreSQL. */
export function rewritePgPlaceholders(sql: string): string {
	let out = ''
	let index = 0
	let param = 0
	while (index < sql.length) {
		const ch = sql[index]
		if (ch === "'" || ch === '"') {
			const quote = ch
			out += ch
			index += 1
			while (index < sql.length) {
				const inner = sql[index]
				out += inner
				index += 1
				if (inner === quote) {
					if (sql[index] === quote) {
						out += sql[index]
						index += 1
						continue
					}
					break
				}
			}
			continue
		}
		if (ch === '-' && sql[index + 1] === '-') {
			const end = sql.indexOf('\n', index)
			if (end === -1) {
				out += sql.slice(index)
				break
			}
			out += sql.slice(index, end + 1)
			index = end + 1
			continue
		}
		if (ch === '/' && sql[index + 1] === '*') {
			const end = sql.indexOf('*/', index + 2)
			if (end === -1) {
				out += sql.slice(index)
				break
			}
			out += sql.slice(index, end + 2)
			index = end + 2
			continue
		}
		if (ch === '?') {
			param += 1
			out += `$${param}`
			index += 1
			continue
		}
		out += ch
		index += 1
	}
	return out
}

/** Split semicolon-separated SQL statements while respecting quotes and comments. */
export function splitSqlStatements(sql: string): string[] {
	const statements: string[] = []
	let start = 0
	let index = 0
	while (index < sql.length) {
		const ch = sql[index]
		if (ch === "'" || ch === '"') {
			const quote = ch
			index += 1
			while (index < sql.length) {
				const inner = sql[index]
				index += 1
				if (inner === quote) {
					if (sql[index] === quote) {
						index += 1
						continue
					}
					break
				}
			}
			continue
		}
		if (ch === '-' && sql[index + 1] === '-') {
			const end = sql.indexOf('\n', index)
			if (end === -1) break
			index = end + 1
			continue
		}
		if (ch === '/' && sql[index + 1] === '*') {
			const end = sql.indexOf('*/', index + 2)
			if (end === -1) break
			index = end + 2
			continue
		}
		if (ch === ';') {
			const part = sql.slice(start, index).trim()
			if (part.length > 0) statements.push(part)
			start = index + 1
		}
		index += 1
	}
	const tail = sql.slice(start).trim()
	if (tail.length > 0) statements.push(tail)
	return statements
}
