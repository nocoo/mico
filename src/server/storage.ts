import { DefaultAzureCredential, type TokenCredential } from '@azure/identity'
import { createAzureBlobStore } from './blob-azure.ts'
import { createR2BlobStore } from './blob-r2.ts'
import { createD1Sql } from './sql-d1.ts'
import { createPostgresSql } from './sql-postgres.ts'
import { BoardStore } from './store.ts'

const AZURE_PG_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default'

export type StorageBackend = 'sqlite' | 'azure' | 'cloudflare'

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
	const value = env[key]?.trim()
	return value ? value : undefined
}

function requireEnv(env: NodeJS.ProcessEnv, key: string, backend: StorageBackend): string {
	const value = readEnv(env, key)
	if (!value) {
		throw new Error(`${key} is required when MICO_STORAGE_BACKEND=${backend}`)
	}
	return value
}

export function resolveStorageBackend(env: NodeJS.ProcessEnv): StorageBackend {
	const raw = readEnv(env, 'MICO_STORAGE_BACKEND')?.toLowerCase()
	if (!raw) return 'sqlite'
	if (raw === 'sqlite' || raw === 'azure' || raw === 'cloudflare') return raw
	throw new Error(`Unsupported MICO_STORAGE_BACKEND: ${raw}`)
}

export interface CreateStorageOptions {
	readonly dbPath?: string
	readonly managedIdentityCredential?: TokenCredential
}

/**
 * Construct a `BoardStore` from environment variables for one of:
 * `sqlite` (default local file), `azure` (PostgreSQL + Azure Blob), or
 * `cloudflare` (D1 + R2).
 */
export function createBoardStoreFromEnv(
	env: NodeJS.ProcessEnv,
	options: CreateStorageOptions = {},
): BoardStore {
	if (options.dbPath) {
		return new BoardStore(options.dbPath)
	}
	const backend = resolveStorageBackend(env)
	if (backend === 'sqlite') {
		return new BoardStore(readEnv(env, 'MICO_DB_PATH') ?? '.mico/board.sqlite')
	}

	if (backend === 'azure') {
		const connectionString =
			readEnv(env, 'MICO_PG_URL') ?? readEnv(env, 'DATABASE_URL') ?? undefined
		const host = readEnv(env, 'MICO_PG_HOST')
		if (!connectionString && !host) {
			throw new Error('MICO_PG_URL (or MICO_PG_HOST) is required when MICO_STORAGE_BACKEND=azure')
		}
		const sslMode = readEnv(env, 'MICO_PG_SSL')?.toLowerCase()
		const pgAuthMode = readEnv(env, 'MICO_PG_AUTH_MODE')?.toLowerCase()
		let pgPassword: string | (() => Promise<string>) | undefined = readEnv(env, 'MICO_PG_PASSWORD')
		if (pgAuthMode === 'managed-identity') {
			const credential = options.managedIdentityCredential ?? new DefaultAzureCredential()
			pgPassword = async () => {
				const token = await credential.getToken(AZURE_PG_SCOPE)
				if (!token?.token) {
					throw new Error('Failed to acquire Azure PostgreSQL access token')
				}
				return token.token
			}
		}
		const sql = createPostgresSql({
			connectionString,
			host,
			port: readEnv(env, 'MICO_PG_PORT') ? Number(readEnv(env, 'MICO_PG_PORT')) : undefined,
			database: readEnv(env, 'MICO_PG_DATABASE'),
			user: readEnv(env, 'MICO_PG_USER'),
			password: pgPassword,
			ssl: !(sslMode === 'false' || sslMode === 'disable'),
		})
		const blobs = createAzureBlobStore({
			accountName: requireEnv(env, 'MICO_AZURE_STORAGE_ACCOUNT', 'azure'),
			containerName: readEnv(env, 'MICO_AZURE_STORAGE_CONTAINER') ?? 'mico-assets',
			endpoint: readEnv(env, 'MICO_AZURE_BLOB_ENDPOINT'),
			credential: options.managedIdentityCredential,
		})
		return new BoardStore({ sql, blobs })
	}

	const accountId = requireEnv(env, 'MICO_CF_ACCOUNT_ID', 'cloudflare')
	const sql = createD1Sql({
		accountId,
		databaseId: requireEnv(env, 'MICO_CF_D1_DATABASE_ID', 'cloudflare'),
		apiToken: requireEnv(env, 'MICO_CF_API_TOKEN', 'cloudflare'),
		endpoint: readEnv(env, 'MICO_CF_API_ENDPOINT'),
	})
	const blobs = createR2BlobStore({
		accountId,
		bucket: requireEnv(env, 'MICO_CF_R2_BUCKET', 'cloudflare'),
		accessKeyId: requireEnv(env, 'MICO_CF_R2_ACCESS_KEY_ID', 'cloudflare'),
		secretAccessKey: requireEnv(env, 'MICO_CF_R2_SECRET_ACCESS_KEY', 'cloudflare'),
		endpoint: readEnv(env, 'MICO_CF_R2_ENDPOINT'),
	})
	return new BoardStore({ sql, blobs })
}
