import assert from 'node:assert/strict'
import { test } from 'node:test'
import { imagePreserveAspectRatio, isSupportedImageFile, scaleImageDimensions } from './image.ts'

test('image scaling preserves aspect and sensible limits', () => {
	assert.deepEqual(scaleImageDimensions(800, 600), { w: 360, h: 270 })
	assert.deepEqual(scaleImageDimensions(600, 800), { w: 210, h: 280 })
	assert.deepEqual(scaleImageDimensions(80, 40), { w: 360, h: 180 })
	assert.deepEqual(scaleImageDimensions(1, 1), { w: 280, h: 280 })
})

test('only daemon-supported raster MIME types are accepted', () => {
	assert.equal(isSupportedImageFile({ type: 'image/png' }), true)
	assert.equal(isSupportedImageFile({ type: 'image/jpeg' }), true)
	assert.equal(isSupportedImageFile({ type: 'image/webp' }), true)
	assert.equal(isSupportedImageFile({ type: 'image/gif' }), true)
	assert.equal(isSupportedImageFile({ type: 'image/jpg' }), false)
	assert.equal(isSupportedImageFile({ type: 'image/svg+xml' }), false)
})

test('frame image fit maps to SVG preserveAspectRatio modes', () => {
	assert.equal(imagePreserveAspectRatio('cover'), 'xMidYMid slice')
	assert.equal(imagePreserveAspectRatio('contain'), 'xMidYMid meet')
	assert.equal(imagePreserveAspectRatio('stretch'), 'none')
	assert.equal(imagePreserveAspectRatio(undefined), 'xMidYMid slice')
})
