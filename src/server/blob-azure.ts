import { DefaultAzureCredential, type TokenCredential } from '@azure/identity'
import { type BlobObject, type BlobStore, encodeBlobKeyPath } from './blob.ts'

const AZURE_STORAGE_SCOPE = 'https://storage.azure.com/.default'
const AZURE_BLOB_API_VERSION = '2023-11-03'

export interface AzureBlobConfig {
	readonly accountName: string
	readonly containerName: string
	readonly endpoint?: string
	readonly credential?: TokenCredential
	readonly tokenProvider?: () => Promise<string>
	readonly fetch?: typeof fetch
}

/** Create an Azure Blob Storage `BlobStore` authenticated via Managed Identity / `DefaultAzureCredential`. */
export function createAzureBlobStore(config: AzureBlobConfig): BlobStore {
	const fetchImpl = config.fetch ?? globalThis.fetch
	const base = (config.endpoint ?? `https://${config.accountName}.blob.core.windows.net`).replace(
		/\/+$/,
		'',
	)
	const container = encodeURIComponent(config.containerName)

	let credential: TokenCredential | undefined = config.credential
	const getBearerToken = async (): Promise<string> => {
		if (config.tokenProvider) return config.tokenProvider()
		credential ??= new DefaultAzureCredential()
		const token = await credential.getToken(AZURE_STORAGE_SCOPE)
		if (!token?.token) {
			throw new Error('Failed to acquire Azure Storage access token')
		}
		return token.token
	}

	const blobUrl = (key: string) => `${base}/${container}/${encodeBlobKeyPath(key)}`

	const commonHeaders = async (): Promise<Record<string, string>> => ({
		Authorization: `Bearer ${await getBearerToken()}`,
		'x-ms-version': AZURE_BLOB_API_VERSION,
		'x-ms-date': new Date().toUTCString(),
	})

	return {
		async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
			const headers = {
				...(await commonHeaders()),
				'x-ms-blob-type': 'BlockBlob',
				'Content-Type': contentType,
				'Content-Length': String(bytes.byteLength),
			}
			const response = await fetchImpl(blobUrl(key), {
				method: 'PUT',
				headers,
				body: Buffer.from(bytes),
			})
			if (!response.ok) {
				const detail = await response.text().catch(() => '')
				throw new Error(
					`Azure Blob PUT failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
				)
			}
		},

		async get(key: string): Promise<BlobObject | undefined> {
			const response = await fetchImpl(blobUrl(key), {
				method: 'GET',
				headers: await commonHeaders(),
			})
			if (response.status === 404) return undefined
			if (!response.ok) {
				const detail = await response.text().catch(() => '')
				throw new Error(
					`Azure Blob GET failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
				)
			}
			const bytes = new Uint8Array(await response.arrayBuffer())
			const contentType = response.headers.get('content-type') || 'application/octet-stream'
			return { bytes, contentType }
		},

		async delete(key: string): Promise<void> {
			const response = await fetchImpl(blobUrl(key), {
				method: 'DELETE',
				headers: await commonHeaders(),
			})
			if (response.status === 404 || response.ok) return
			const detail = await response.text().catch(() => '')
			throw new Error(
				`Azure Blob DELETE failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
			)
		},
	}
}
