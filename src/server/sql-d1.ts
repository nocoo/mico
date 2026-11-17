import {
	createMutex,
	type Sql,
	type SqlTransaction,
	type SqlValue,
	splitSqlStatements,
} from './sql.ts'

export interface D1RunMeta {
	readonly changes?: number
}

export interface D1Result<T = Record<string, unknown>> {
	readonly results?: T[]
	readonly meta?: D1RunMeta
}

export interface D1PreparedStatementLike {
	bind(...values: readonly unknown[]): D1PreparedStatementLike
	first<T = Record<string, unknown>>(): Promise<T | null>
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>
	run(): Promise<D1Result>
}

export interface D1DatabaseLike {
	prepare(query: string): D1PreparedStatementLike
	batch<T = Record<string, unknown>>(
		statements: readonly D1PreparedStatementLike[],
	): Promise<D1Result<T>[]>
	exec?(query: string): Promise<unknown>
}

export interface D1HttpConfig {
	readonly accountId: string
	readonly databaseId: string
	readonly apiToken: string
	readonly endpoint?: string
	readonly fetch?: typeof fetch
}

function isD1Database(source: D1DatabaseLike | D1HttpConfig): source is D1DatabaseLike {
	return typeof (source as D1DatabaseLike).prepare === 'function'
}

interface CfD1ApiResponse {
	readonly success: boolean
	readonly errors?: ReadonlyArray<{ readonly code?: number; readonly message?: string }>
	readonly result?: ReadonlyArray<{
		readonly success?: boolean
		readonly results?: Record<string, unknown>[]
		readonly meta?: { readonly changes?: number }
	}>
}

function toJsonParam(value: SqlValue): string | number | null {
	if (value instanceof Uint8Array) {
		throw new Error('D1 HTTP API does not support binary BLOB parameters; store binaries in R2')
	}
	return value
}

/** Wrap Cloudflare's D1 REST `/query` endpoint as a `D1DatabaseLike` client. */
export function createD1HttpDatabase(config: D1HttpConfig): D1DatabaseLike {
	const fetchImpl = config.fetch ?? globalThis.fetch
	const base = (config.endpoint ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '')
	const url = `${base}/accounts/${encodeURIComponent(config.accountId)}/d1/database/${encodeURIComponent(config.databaseId)}/query`

	async function queryOne<T>(sql: string, params: readonly SqlValue[]): Promise<D1Result<T>> {
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.apiToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				sql,
				params: params.map(toJsonParam),
			}),
		})
		const payload = (await response.json().catch(() => null)) as CfD1ApiResponse | null
		if (!response.ok || !payload?.success) {
			const message =
				payload?.errors
					?.map((e) => e.message)
					.filter(Boolean)
					.join('; ') || `D1 HTTP query failed (${response.status})`
			throw new Error(message)
		}
		const first = payload.result?.[0]
		return {
			results: (first?.results ?? []) as T[],
			meta: { changes: first?.meta?.changes ?? 0 },
		}
	}

	const makeStatement = (
		sql: string,
		params: readonly SqlValue[] = [],
	): D1PreparedStatementLike & {
		readonly _sql: string
		readonly _params: readonly SqlValue[]
	} => ({
		_sql: sql,
		_params: params,
		bind(...values: readonly unknown[]) {
			return makeStatement(sql, values as readonly SqlValue[])
		},
		async first<T>() {
			const res = await queryOne<T>(sql, params)
			return res.results?.[0] ?? null
		},
		all<T>() {
			return queryOne<T>(sql, params)
		},
		run() {
			return queryOne(sql, params)
		},
	})

	return {
		prepare(query: string) {
			return makeStatement(query)
		},
		async batch<T>(statements: readonly D1PreparedStatementLike[]) {
			const out: D1Result<T>[] = []
			for (const statement of statements) {
				out.push(await statement.all<T>())
			}
			return out
		},
	}
}

/**
 * Create a Cloudflare D1-backed `Sql` driver from either a Worker `D1Database`
 * binding or a Node.js `D1HttpConfig`.
 */
export function createD1Sql(source: D1DatabaseLike | D1HttpConfig): Sql {
	const db = isD1Database(source) ? source : createD1HttpDatabase(source)
	const serialize = createMutex()
	let closed = false

	const assertOpen = () => {
		if (closed) throw new Error('SQL driver is closed')
	}

	const bindStatement = (sql: string, params: readonly SqlValue[]) => {
		const prepared = db.prepare(sql)
		return params.length > 0 ? prepared.bind(...params) : prepared
	}

	const directExec = async (sql: string): Promise<void> => {
		assertOpen()
		const statements = splitSqlStatements(sql)
		if (statements.length === 0) return
		await db.batch(statements.map((stmt) => db.prepare(stmt)))
	}

	const directGet = async <T>(
		sql: string,
		params: readonly SqlValue[] = [],
	): Promise<T | undefined> => {
		assertOpen()
		const row = await bindStatement(sql, params).first<T>()
		return row ?? undefined
	}

	const directAll = async <T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> => {
		assertOpen()
		const res = await bindStatement(sql, params).all<T>()
		return res.results ?? []
	}

	const directRun = async (sql: string, params: readonly SqlValue[] = []): Promise<number> => {
		assertOpen()
		const res = await bindStatement(sql, params).run()
		return Number(res.meta?.changes ?? 0)
	}

	const directHasTable = async (name: string): Promise<boolean> => {
		const row = await directGet<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
			[name],
		)
		return row !== undefined
	}

	const txSql: SqlTransaction = {
		exec: directExec,
		get: directGet,
		all: directAll,
		run: directRun,
		hasTable: directHasTable,
	}

	return {
		dialect: 'd1',
		concurrent: false,
		exec: (sql) => serialize(() => directExec(sql)),
		get: <T>(sql: string, params: readonly SqlValue[] = []) =>
			serialize(() => directGet<T>(sql, params)),
		all: <T>(sql: string, params: readonly SqlValue[] = []) =>
			serialize(() => directAll<T>(sql, params)),
		run: (sql, params = []) => serialize(() => directRun(sql, params)),
		hasTable: (name) => serialize(() => directHasTable(name)),
		transaction: <T>(operation: (tx: SqlTransaction) => Promise<T>) =>
			serialize(() => operation(txSql)),
		async close(): Promise<void> {
			closed = true
		},
	}
}
