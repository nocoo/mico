package view

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"sync"

	"github.com/egoist/mygo/ui"
	"github.com/nocoo/mico/apps/macos/resources"
)

var (
	IconWave = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4"/><path d="M8 7v10"/><path d="M12 4v16"/><path d="M16 7v10"/><path d="M20 10v4"/></svg>`))

	IconMic = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/><path d="M8 22h8"/></svg>`))

	IconSpeaker = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`))

	IconShield = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`))

	IconCheck = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`))

	IconAlert = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`))

	IconRefresh = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`))

	IconStop = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>`))
)

var (
	logoOnce   sync.Once
	logoBitmap *ui.Bitmap
)

func MicoLogoBitmap() *ui.Bitmap {
	logoOnce.Do(func() {
		if bmp, err := ui.DecodeBitmapScaled(resources.LogoPNG, 160); err == nil {
			logoBitmap = bmp
		}
	})
	return logoBitmap
}

// TrayIconIdlePNG renders a crisp 36x36 (@2x 18pt) monochrome template icon
// shaped like the Mico logo (rounded frame + header bar + two eyes).
func TrayIconIdlePNG() []byte {
	ink := color.NRGBA{R: 0, G: 0, B: 0, A: 255}
	return renderMicoTrayPNG(ink, ink, ink, false)
}

// TrayIconStreamingPNG renders the Mico logo mark with its signature pink & sky-blue
// eyes plus an emerald live indicator dot while audio is streaming.
func TrayIconStreamingPNG() []byte {
	frame := color.NRGBA{R: 118, G: 102, B: 244, A: 255}
	leftEye := color.NRGBA{R: 248, G: 158, B: 174, A: 255}
	rightEye := color.NRGBA{R: 116, G: 180, B: 255, A: 255}
	return renderMicoTrayPNG(frame, leftEye, rightEye, true)
}

func renderMicoTrayPNG(frameColor, leftEyeColor, rightEyeColor color.NRGBA, withLiveDot bool) []byte {
	const size = 36
	img := image.NewNRGBA(image.Rect(0, 0, size, size))

	const cx, cy = 18.0, 18.0
	const halfW, halfH, cornerR = 13.0, 13.0, 6.2
	const strokeHalf = 1.35

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			px := float64(x) + 0.5
			py := float64(y) + 0.5

			// Outer rounded squircle ring
			dBox := sdRoundedBox(px-cx, py-cy, halfW, halfH, cornerR)
			dRing := math.Abs(dBox) - strokeHalf
			frameCov := clamp01(0.5 - dRing)

			// Signature top header bar inside the frame
			if dBox <= 0 {
				dBar := sdCapsuleHorizontal(px-cx, py-11.2, 10.5, 1.0)
				barCov := clamp01(0.5 - dBar)
				if barCov > frameCov {
					frameCov = barCov
				}
			}

			if frameCov > 0 {
				a := uint8(math.Round(float64(frameColor.A) * frameCov))
				img.SetNRGBA(x, y, color.NRGBA{R: frameColor.R, G: frameColor.G, B: frameColor.B, A: a})
			}

			// Mico's signature left & right eyes
			dLeft := math.Hypot(px-13.2, py-21.2) - 3.0
			if cov := clamp01(0.5 - dLeft); cov > 0 {
				a := uint8(math.Round(float64(leftEyeColor.A) * cov))
				img.SetNRGBA(x, y, blendOver(img.NRGBAAt(x, y), color.NRGBA{
					R: leftEyeColor.R, G: leftEyeColor.G, B: leftEyeColor.B, A: a,
				}))
			}

			dRight := math.Hypot(px-22.8, py-21.2) - 3.0
			if cov := clamp01(0.5 - dRight); cov > 0 {
				a := uint8(math.Round(float64(rightEyeColor.A) * cov))
				img.SetNRGBA(x, y, blendOver(img.NRGBAAt(x, y), color.NRGBA{
					R: rightEyeColor.R, G: rightEyeColor.G, B: rightEyeColor.B, A: a,
				}))
			}
		}
	}

	if withLiveDot {
		dotColor := color.NRGBA{R: 47, G: 204, B: 118, A: 255}
		const dx, dy, r = 29.0, 7.5, 4.2
		for y := 0; y < size; y++ {
			for x := 0; x < size; x++ {
				px := float64(x) + 0.5
				py := float64(y) + 0.5
				dist := math.Hypot(px-dx, py-dy) - r
				if cov := clamp01(0.5 - dist); cov > 0 {
					a := uint8(math.Round(255 * cov))
					img.SetNRGBA(x, y, blendOver(img.NRGBAAt(x, y), color.NRGBA{
						R: dotColor.R, G: dotColor.G, B: dotColor.B, A: a,
					}))
				}
			}
		}
	}

	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func sdRoundedBox(px, py, bx, by, r float64) float64 {
	qx := math.Abs(px) - bx + r
	qy := math.Abs(py) - by + r
	outside := math.Hypot(math.Max(qx, 0), math.Max(qy, 0))
	inside := math.Min(math.Max(qx, qy), 0)
	return outside + inside - r
}

func sdCapsuleHorizontal(px, py, halfSpan, radius float64) float64 {
	clampedX := math.Max(-halfSpan, math.Min(halfSpan, px))
	return math.Hypot(px-clampedX, py) - radius
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func blendOver(dst, src color.NRGBA) color.NRGBA {
	sa := float64(src.A) / 255.0
	da := float64(dst.A) / 255.0
	outA := sa + da*(1-sa)
	if outA <= 0 {
		return color.NRGBA{}
	}
	outR := (float64(src.R)*sa + float64(dst.R)*da*(1-sa)) / outA
	outG := (float64(src.G)*sa + float64(dst.G)*da*(1-sa)) / outA
	outB := (float64(src.B)*sa + float64(dst.B)*da*(1-sa)) / outA
	return color.NRGBA{
		R: uint8(math.Round(outR)),
		G: uint8(math.Round(outG)),
		B: uint8(math.Round(outB)),
		A: uint8(math.Round(outA * 255)),
	}
}
