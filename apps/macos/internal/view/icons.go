package view

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"

	"github.com/egoist/mygo/ui"
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

// TrayIconIdlePNG renders a crisp 36x36 (@2x 18pt) monochrome template waveform icon
// for the macOS menu bar. macOS tints template images automatically for light/dark bars.
func TrayIconIdlePNG() []byte {
	return renderTrayWaveformPNG(color.NRGBA{R: 0, G: 0, B: 0, A: 255}, false)
}

// TrayIconStreamingPNG renders an active Mico indigo waveform with an emerald live dot.
func TrayIconStreamingPNG() []byte {
	return renderTrayWaveformPNG(color.NRGBA{R: 120, G: 108, B: 248, A: 255}, true)
}

func renderTrayWaveformPNG(barColor color.NRGBA, withLiveDot bool) []byte {
	const size = 36
	img := image.NewNRGBA(image.Rect(0, 0, size, size))

	type bar struct {
		cx float64
		h  float64
	}
	bars := []bar{
		{cx: 7.0, h: 10.0},
		{cx: 12.5, h: 18.0},
		{cx: 18.0, h: 24.0},
		{cx: 23.5, h: 16.0},
		{cx: 29.0, h: 9.0},
	}

	const barHalfW = 1.65
	const cy = 18.0

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			px := float64(x) + 0.5
			py := float64(y) + 0.5
			maxCov := 0.0
			for _, b := range bars {
				halfH := b.h / 2.0
				d := sdCapsuleVertical(px-b.cx, py-cy, halfH-barHalfW, barHalfW)
				cov := clamp01(0.5 - d)
				if cov > maxCov {
					maxCov = cov
				}
			}
			if maxCov > 0 {
				a := uint8(math.Round(float64(barColor.A) * maxCov))
				img.SetNRGBA(x, y, color.NRGBA{R: barColor.R, G: barColor.G, B: barColor.B, A: a})
			}
		}
	}

	if withLiveDot {
		dotColor := color.NRGBA{R: 47, G: 196, B: 112, A: 255}
		const dx, dy, r = 29.0, 8.5, 4.0
		for y := 0; y < size; y++ {
			for x := 0; x < size; x++ {
				px := float64(x) + 0.5
				py := float64(y) + 0.5
				dist := math.Hypot(px-dx, py-dy) - r
				cov := clamp01(0.5 - dist)
				if cov > 0 {
					a := uint8(math.Round(255 * cov))
					dst := img.NRGBAAt(x, y)
					img.SetNRGBA(x, y, blendOver(dst, color.NRGBA{R: dotColor.R, G: dotColor.G, B: dotColor.B, A: a}))
				}
			}
		}
	}

	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func sdCapsuleVertical(px, py, halfSpan, radius float64) float64 {
	clampedY := math.Max(-halfSpan, math.Min(halfSpan, py))
	return math.Hypot(px, py-clampedY) - radius
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
