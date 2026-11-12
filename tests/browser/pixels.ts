import type { Page } from '@playwright/test'

export async function differingPixels(page: Page, reference: Buffer, actual: Buffer) {
	return page.evaluate(
		async ({ reference, actual }) => {
			const image = async (data: string) => {
				const response = await fetch(`data:image/png;base64,${data}`)
				return createImageBitmap(await response.blob())
			}
			const [expected, received] = await Promise.all([image(reference), image(actual)])
			if (expected.width !== received.width || expected.height !== received.height) {
				throw new Error(
					`Image sizes differ: ${expected.width}×${expected.height} vs ${received.width}×${received.height}`,
				)
			}
			const canvas = document.createElement('canvas')
			canvas.width = expected.width
			canvas.height = expected.height
			const context = canvas.getContext('2d', { willReadFrequently: true })
			if (!context) throw new Error('Canvas context unavailable')
			context.drawImage(expected, 0, 0)
			const a = context.getImageData(0, 0, canvas.width, canvas.height).data
			context.clearRect(0, 0, canvas.width, canvas.height)
			context.drawImage(received, 0, 0)
			const b = context.getImageData(0, 0, canvas.width, canvas.height).data
			let different = 0
			for (let i = 0; i < a.length; i += 4) {
				if ([0, 1, 2, 3].some((channel) => Math.abs(a[i + channel] - b[i + channel]) > 5.1))
					different++
			}
			expected.close()
			received.close()
			return { different, total: canvas.width * canvas.height }
		},
		{ reference: reference.toString('base64'), actual: actual.toString('base64') },
	)
}
