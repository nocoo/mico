import { Pool, type PoolClient, type QueryResult } from 'pg'
import { rewritePgPlaceholders, type Sql, type SqlTransaction, type SqlValue } from './sql.ts'

export interface PgClientLike {
	query(
		text: string,
		values?: readonly unknown[],
	): Promise<{
		rows: Record<string, unknown>[]
		rowCount: number | null
	}>
	release(err?: Error | boolean): void
}

export interface PgPoolLike {
	query(
		text: string,
		values?: readonly unknown[],
	): Promise<{
		rows: Record<string, unknown>[]
		rowCount: number | null
	}>
	connect(): Promise<PgClientLike>
	end(): Promise<void>
}

export interface PostgresSqlConfig {
	readonly connectionString?: string
	readonly host?: string
	readonly port?: number
	readonly database?: string
	readonly user?: string
	readonly password?: string | (() => string | Promise<string>)
	readonly ssl?: boolean | { readonly rejectUnauthorized?: boolean }
	readonly max?: number
	readonly pool?: PgPoolLike
}

function normalizeParam(value: SqlValue): unknown {
	if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
		return Buffer.from(value)
	}
	return value
}

function normalizeParams(params: readonly SqlValue[]): unknown[] {
	return params.map(normalizeParam)
}

function buildTransactionSql(
	queryable: Pick<PgClientLike, 'query'>,
	isClosed: () => boolean,
): SqlTransaction {
	const assertOpen = () => {
		if (isClosed()) throw new Error('SQL driver is closed')
	}

	return {
		async exec(sql: string): Promise<void> {
			assertOpen()
			await queryable.query(sql)
		},
		async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
			assertOpen()
			const res = await queryable.query(rewritePgPlaceholders(sql), normalizeParams(params))
			return res.rows[0] as T | undefined
		},
		async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
			assertOpen()
			const res = await queryable.query(rewritePgPlaceholders(sql), normalizeParams(params))
			return res.rows as T[]
		},
		async run(sql: string, params: readonly SqlValue[] = []): Promise<number> {
			assertOpen()
			const res = await queryable.query(rewritePgPlaceholders(sql), normalizeParams(params))
			return res.rowCount ?? 0
		},
		async hasTable(name: string): Promise<boolean> {
			assertOpen()
			const res = await queryable.query('SELECT to_regclass($1) AS name', [name])
			const row = res.rows[0] as { name: string | null } | undefined
			return Boolean(row?.name)
		},
	}
}

/** Create a PostgreSQL-backed `Sql` driver using `pg.Pool` or an injected pool. */
export function createPostgresSql(config: PostgresSqlConfig): Sql {
	const pool: PgPoolLike =
		config.pool ??
		(new Pool({
			connectionString: config.connectionString,
			host: config.host,
			port: config.port,
			database: config.database,
			user: config.user,
			password: config.password,
			ssl: config.ssl === true ? { rejectUnauthorized: true } : config.ssl || undefined,
			max: config.max,
		}) as unknown as {
			query(text: string, values?: readonly unknown[]): Promise<QueryResult>
			connect(): Promise<PoolClient>
			end(): Promise<void>
		})

	let closed = false
	let closePromise: Promise<void> | undefined
	const base = buildTransactionSql(pool, () => closed)

	return {
		dialect: 'postgres',
		concurrent: true,
		...base,
		async transaction<T>(operation: (tx: SqlTransaction) => Promise<T>): Promise<T> {
			if (closed) throw new Error('SQL driver is closed')
			const client = await pool.connect()
			const tx = buildTransactionSql(client, () => closed)
			let completed = false
			try {
				await client.query('BEGIN')
				const result = await operation(tx)
				await client.query('COMMIT')
				completed = true
				return result
			} catch (error) {
				if (!completed) {
					await client.query('ROLLBACK').catch(() => undefined)
				}
				throw error
			} finally {
				client.release()
			}
		},
		close(): Promise<void> {
			if (!closePromise) {
				closed = true
				closePromise = pool.end()
			}
			return closePromise
		},
	}
}
