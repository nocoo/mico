export interface BlobObject {
	readonly bytes: Uint8Array
	readonly contentType: string
}

export interface BlobStore {
	put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
	get(key: string): Promise<BlobObject | undefined>
	delete(key: string): Promise<void>
	close?(): Promise<void>
}

export function imageBlobKey(tenantId: string, imageId: string): string {
	return `${tenantId}/${imageId}`
}

/** Encode each path segment of a blob key while preserving `/` separators. */
export function encodeBlobKeyPath(key: string): string {
	return key
		.split('/')
		.filter((segment) => segment.length > 0)
		.map((segment) => encodeURIComponent(segment))
		.join('/')
}

/** In-memory `BlobStore` for unit tests. */
export function createMemoryBlobStore(): BlobStore {
	const objects = new Map<string, BlobObject>()
	return {
		async put(key, bytes, contentType) {
			objects.set(key, { bytes: new Uint8Array(bytes), contentType })
		},
		async get(key) {
			const entry = objects.get(key)
			if (!entry) return undefined
			return { bytes: new Uint8Array(entry.bytes), contentType: entry.contentType }
		},
		async delete(key) {
			objects.delete(key)
		},
	}
}
