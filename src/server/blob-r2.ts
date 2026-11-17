import { createHash, createHmac } from 'node:crypto'
import { type BlobStore, encodeBlobKeyPath } from './blob.ts'

export interface R2ObjectBodyLike {
	readonly httpMetadata?: { readonly contentType?: string }
	arrayBuffer(): Promise<ArrayBuffer>
}

export interface R2BucketLike {
	put(
		key: string,
		value: ArrayBuffer | ArrayBufferView | string,
		options?: { readonly httpMetadata?: { readonly contentType?: string } },
	): Promise<unknown>
	get(key: string): Promise<R2ObjectBodyLike | null>
	delete(key: string): Promise<void>
}

export interface R2S3Config {
	readonly accountId: string
	readonly bucket: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly endpoint?: string
	readonly region?: string
	readonly fetch?: typeof fetch
}

function isR2Bucket(source: R2BucketLike | R2S3Config): source is R2BucketLike {
	return (
		typeof (source as R2BucketLike).put === 'function' &&
		typeof (source as R2BucketLike).get === 'function' &&
		typeof (source as R2BucketLike).delete === 'function'
	)
}

function sha256Hex(data: string | Uint8Array): string {
	return createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: string | Uint8Array, data: string): Buffer {
	return createHmac('sha256', key).update(data).digest()
}

function amzTimestamps(now: Date): { readonly amzDate: string; readonly dateStamp: string } {
	const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
	return {
		amzDate: iso,
		dateStamp: iso.slice(0, 8),
	}
}

export function signR2S3Request(input: {
	readonly method: 'PUT' | 'GET' | 'DELETE'
	readonly url: URL
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly region: string
	readonly payload: Uint8Array
	readonly extraHeaders?: Record<string, string>
	readonly now?: Date
}): Record<string, string> {
	const { amzDate, dateStamp } = amzTimestamps(input.now ?? new Date())
	const payloadHash = sha256Hex(input.payload)
	const headers: Record<string, string> = {
		host: input.url.host,
		'x-amz-content-sha256': payloadHash,
		'x-amz-date': amzDate,
	}
	if (input.extraHeaders) {
		for (const [key, value] of Object.entries(input.extraHeaders)) {
			headers[key.toLowerCase()] = value
		}
	}
	const sortedKeys = Object.keys(headers).sort()
	const canonicalHeaders = sortedKeys.map((key) => `${key}:${headers[key]}\n`).join('')
	const signedHeaders = sortedKeys.join(';')
	const canonicalRequest = [
		input.method,
		input.url.pathname,
		input.url.searchParams.toString(),
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join('\n')

	const scope = `${dateStamp}/${input.region}/s3/aws4_request`
	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
	const kDate = hmacSha256(`AWS4${input.secretAccessKey}`, dateStamp)
	const kRegion = hmacSha256(kDate, input.region)
	const kService = hmacSha256(kRegion, 's3')
	const kSigning = hmacSha256(kService, 'aws4_request')
	const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')

	return {
		...headers,
		Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	}
}

/**
 * Create a Cloudflare R2 `BlobStore` from either a Worker `R2Bucket` binding
 * or a Node.js S3-compatible `R2S3Config`.
 */
export function createR2BlobStore(source: R2BucketLike | R2S3Config): BlobStore {
	if (isR2Bucket(source)) {
		return {
			async put(key, bytes, contentType) {
				await source.put(key, bytes, { httpMetadata: { contentType } })
			},
			async get(key) {
				const object = await source.get(key)
				if (!object) return undefined
				return {
					bytes: new Uint8Array(await object.arrayBuffer()),
					contentType: object.httpMetadata?.contentType || 'application/octet-stream',
				}
			},
			async delete(key) {
				await source.delete(key)
			},
		}
	}

	const fetchImpl = source.fetch ?? globalThis.fetch
	const region = source.region ?? 'auto'
	const base = (source.endpoint ?? `https://${source.accountId}.r2.cloudflarestorage.com`).replace(
		/\/+$/,
		'',
	)
	const bucket = encodeURIComponent(source.bucket)
	const objectUrl = (key: string) => new URL(`${base}/${bucket}/${encodeBlobKeyPath(key)}`)

	return {
		async put(key, bytes, contentType) {
			const url = objectUrl(key)
			const headers = signR2S3Request({
				method: 'PUT',
				url,
				accessKeyId: source.accessKeyId,
				secretAccessKey: source.secretAccessKey,
				region,
				payload: bytes,
				extraHeaders: {
					'content-type': contentType,
					'content-length': String(bytes.byteLength),
				},
			})
			const response = await fetchImpl(url, {
				method: 'PUT',
				headers,
				body: Buffer.from(bytes),
			})
			if (!response.ok) {
				const detail = await response.text().catch(() => '')
				throw new Error(
					`R2 PUT failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
				)
			}
		},

		async get(key) {
			const url = objectUrl(key)
			const headers = signR2S3Request({
				method: 'GET',
				url,
				accessKeyId: source.accessKeyId,
				secretAccessKey: source.secretAccessKey,
				region,
				payload: new Uint8Array(0),
			})
			const response = await fetchImpl(url, { method: 'GET', headers })
			if (response.status === 404) return undefined
			if (!response.ok) {
				const detail = await response.text().catch(() => '')
				throw new Error(
					`R2 GET failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
				)
			}
			const bytes = new Uint8Array(await response.arrayBuffer())
			const contentType = response.headers.get('content-type') || 'application/octet-stream'
			return { bytes, contentType }
		},

		async delete(key) {
			const url = objectUrl(key)
			const headers = signR2S3Request({
				method: 'DELETE',
				url,
				accessKeyId: source.accessKeyId,
				secretAccessKey: source.secretAccessKey,
				region,
				payload: new Uint8Array(0),
			})
			const response = await fetchImpl(url, { method: 'DELETE', headers })
			if (response.status === 404 || response.ok) return
			const detail = await response.text().catch(() => '')
			throw new Error(
				`R2 DELETE failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
			)
		},
	}
}
