export type ImageBackgroundFit = 'cover' | 'contain' | 'stretch'

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function isSupportedImageFile(file: Pick<File, 'type'>): boolean {
	return SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase())
}

export function scaleImageDimensions(
	naturalWidth: number,
	naturalHeight: number,
	maxWidth = 360,
	maxHeight = 280,
): { w: number; h: number } {
	if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
		throw new RangeError('Image dimensions must be finite')
	}
	if (naturalWidth <= 0 || naturalHeight <= 0)
		throw new RangeError('Image dimensions must be positive')
	if (
		!Number.isFinite(maxWidth) ||
		!Number.isFinite(maxHeight) ||
		maxWidth <= 0 ||
		maxHeight <= 0
	) {
		throw new RangeError('Image scale limits must be positive')
	}
	const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight)
	return {
		w: Math.max(1, Math.round(naturalWidth * scale)),
		h: Math.max(1, Math.round(naturalHeight * scale)),
	}
}

export function imagePreserveAspectRatio(fit: ImageBackgroundFit | undefined): string {
	if (fit === 'contain') return 'xMidYMid meet'
	if (fit === 'stretch') return 'none'
	return 'xMidYMid slice'
}

export async function readImageDimensions(file: File): Promise<{ w: number; h: number }> {
	if ('createImageBitmap' in window) {
		const bitmap = await createImageBitmap(file)
		try {
			return { w: bitmap.width, h: bitmap.height }
		} finally {
			bitmap.close()
		}
	}

	const url = URL.createObjectURL(file)
	try {
		const image = new Image()
		image.src = url
		await image.decode()
		return { w: image.naturalWidth, h: image.naturalHeight }
	} finally {
		URL.revokeObjectURL(url)
	}
}
