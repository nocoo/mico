package theme

import "github.com/egoist/mygo/ui"

type Mode int

const (
	ModeSystem Mode = iota
	ModeLight
	ModeDark
)

func (m Mode) String() string {
	switch m {
	case ModeLight:
		return "light"
	case ModeDark:
		return "dark"
	default:
		return "system"
	}
}

type Tokens struct {
	Theme          *ui.Theme
	Dark           bool
	BgGradient     ui.LinearGradient
	HeroReady      ui.LinearGradient
	HeroLive       ui.LinearGradient
	HeroSetup      ui.LinearGradient
	HeroShadow     ui.Color
	HeroChipBg     ui.Color
	HeroChipBorder ui.Color
	HeroText       ui.Color
	HeroSubtext    ui.Color
	CardBg         ui.Color
	CardBorder     ui.Color
	CardShadow     ui.Color
	WellBg         ui.Color
	AccentSoft     ui.Color
	AccentHi       ui.Color
	AccentLo       ui.Color
	SuccessSoft    ui.Color
	SuccessBorder  ui.Color
	WarningSoft    ui.Color
	WarningBorder  ui.Color
	DangerSoft     ui.Color
	DangerBorder   ui.Color
	MeterTrack     ui.Color
	Hairline       ui.Color
}

func Resolve(mode Mode, systemDark bool) Tokens {
	dark := systemDark
	switch mode {
	case ModeLight:
		dark = false
	case ModeDark:
		dark = true
	}
	if dark {
		return darkTokens()
	}
	return lightTokens()
}

func lightTokens() Tokens {
	t := ui.LightTheme()
	t.Background = ui.Hex("#f5f3ff")
	t.Surface = ui.Hex("#ffffff")
	t.SurfaceHover = ui.Hex("#f0edff")
	t.SurfacePressed = ui.Hex("#e5e0ff")
	t.Border = ui.Hex("#dcd8f2")
	t.Text = ui.Hex("#202438")
	t.TextMuted = ui.Hex("#5f6785")
	t.Accent = ui.Hex("#6a5ae6")
	t.AccentHover = ui.Hex("#5b4ad9")
	t.AccentPressed = ui.Hex("#4d3cc4")
	t.AccentText = ui.Hex("#ffffff")
	t.InactiveAccent = ui.Hex("#6a5ae6")
	t.Success = ui.Hex("#239657")
	t.Warning = ui.Hex("#c77810")
	t.Danger = ui.Hex("#d4385c")
	t.Focus = ui.RGBA(106, 90, 230, 0.45)
	t.Selection = ui.RGBA(106, 90, 230, 0.16)
	t.Radius = 11
	t.Spacing = 4
	t.FontSize = 13

	return Tokens{
		Theme: t,
		Dark:  false,
		BgGradient: ui.LinearGradient{
			Angle: 145,
			Stops: []ui.GradientStop{
				{Color: ui.Hex("#f4efff"), At: 0},
				{Color: ui.Hex("#f9f6fb"), At: 0.48},
				{Color: ui.Hex("#edf5ff"), At: 1},
			},
		},
		HeroReady: ui.LinearGradient{
			Angle: 135,
			Stops: []ui.GradientStop{
				{Color: ui.Hex("#7865f2"), At: 0},
				{Color: ui.Hex("#6259e8"), At: 0.52},
				{Color: ui.Hex("#4f87f7"), At: 1},
			},
		},
		HeroLive: ui.LinearGradient{
			Angle: 135,
			Stops: []ui.GradientStop{
				{Color: ui.Hex("#189669"), At: 0},
				{Color: ui.Hex("#1a877d"), At: 0.55},
				{Color: ui.Hex("#2878b5"), At: 1},
			},
		},
		HeroSetup: ui.LinearGradient{
			Angle: 135,
			Stops: []ui.GradientStop{
				{Color: ui.Hex("#fff6ea"), At: 0},
				{Color: ui.Hex("#fff1f5"), At: 1},
			},
		},
		HeroShadow:     ui.RGBA(88, 76, 212, 0.28),
		HeroChipBg:     ui.RGBA(255, 255, 255, 0.2),
		HeroChipBorder: ui.RGBA(255, 255, 255, 0.3),
		HeroText:       ui.Hex("#ffffff"),
		HeroSubtext:    ui.RGBA(255, 255, 255, 0.86),
		CardBg:         ui.RGBA(255, 255, 255, 0.86),
		CardBorder:     ui.RGBA(112, 118, 174, 0.2),
		CardShadow:     ui.RGBA(68, 74, 134, 0.1),
		WellBg:         ui.RGBA(106, 90, 230, 0.07),
		AccentSoft:     ui.RGBA(106, 90, 230, 0.12),
		AccentHi:       ui.Hex("#887bf2"),
		AccentLo:       ui.Hex("#5746d6"),
		SuccessSoft:    ui.RGBA(35, 150, 87, 0.13),
		SuccessBorder:  ui.RGBA(35, 150, 87, 0.34),
		WarningSoft:    ui.RGBA(199, 120, 16, 0.13),
		WarningBorder:  ui.RGBA(199, 120, 16, 0.36),
		DangerSoft:     ui.RGBA(212, 56, 92, 0.11),
		DangerBorder:   ui.RGBA(212, 56, 92, 0.36),
		MeterTrack:     ui.RGBA(255, 255, 255, 0.24),
		Hairline:       ui.RGBA(104, 114, 160, 0.16),
	}
}

func darkTokens() Tokens {
	t := ui.DarkTheme()
	t.Background = ui.Hex("#121324")
	t.Surface = ui.Hex("#1c1f36")
	t.SurfaceHover = ui.Hex("#262a47")
	t.SurfacePressed = ui.Hex("#303558")
	t.Border = ui.Hex("#32385c")
	t.Text = ui.Hex("#f3f5fc")
	t.TextMuted = ui.Hex("#9aa3c4")
	t.Accent = ui.Hex("#8678ff")
	t.AccentHover = ui.Hex("#988bff")
	t.AccentPressed = ui.Hex("#6f60ec")
	t.AccentText = ui.Hex("#ffffff")
	t.InactiveAccent = ui.Hex("#8678ff")
	t.Success = ui.Hex("#43cf7e")
	t.Warning = ui.Hex("#f2b644")
	t.Danger = ui.Hex("#f56584")
	t.Focus = ui.RGBA(134, 120, 255, 0.55)
	t.Selection = ui.RGBA(134, 120, 255, 0.24)
	t.Radius = 11
	t.Spacing = 4
	t.FontSize = 13

	return Tokens{
		Theme: t,
		Dark:  true,
		BgGradient: ui.LinearGradient{
			Angle: 145,
			Stops: []ui.GradientStop{
				{Color: ui.Hex("#18162d"), At: 0},
				{Color: ui.Hex("#121424"), At: 0.5},
				{Color: ui.Hex("#10192b"), At: 1},
			},
		},
		HeroReady: ui.LinearGradient{
			Angle: 135,
			Stops: []ui.GradientStop{
				{Color: ui.Hex("#6552e6"), At: 0},
				{Color: ui.Hex("#4d47ba"), At: 0.54},
				{Color: ui.Hex("#355ca8"), At: 1},
			},
		},
		HeroLive: ui.LinearGradient{
			Angle: 135,
			Stops: []ui.GradientStop{
				{Color: ui.Hex("#157957"), At: 0},
				{Color: ui.Hex("#16686b"), At: 0.55},
				{Color: ui.Hex("#1e4e85"), At: 1},
			},
		},
		HeroSetup: ui.LinearGradient{
			Angle: 135,
			Stops: []ui.GradientStop{
				{Color: ui.Hex("#2a221c"), At: 0},
				{Color: ui.Hex("#261c2c"), At: 1},
			},
		},
		HeroShadow:     ui.RGBA(0, 0, 0, 0.45),
		HeroChipBg:     ui.RGBA(255, 255, 255, 0.14),
		HeroChipBorder: ui.RGBA(255, 255, 255, 0.2),
		HeroText:       ui.Hex("#ffffff"),
		HeroSubtext:    ui.RGBA(243, 245, 252, 0.82),
		CardBg:         ui.RGBA(28, 31, 54, 0.84),
		CardBorder:     ui.RGBA(255, 255, 255, 0.11),
		CardShadow:     ui.RGBA(0, 0, 0, 0.34),
		WellBg:         ui.RGBA(255, 255, 255, 0.06),
		AccentSoft:     ui.RGBA(134, 120, 255, 0.2),
		AccentHi:       ui.Hex("#9c90ff"),
		AccentLo:       ui.Hex("#6c5ce7"),
		SuccessSoft:    ui.RGBA(67, 207, 126, 0.17),
		SuccessBorder:  ui.RGBA(67, 207, 126, 0.38),
		WarningSoft:    ui.RGBA(242, 182, 68, 0.15),
		WarningBorder:  ui.RGBA(242, 182, 68, 0.38),
		DangerSoft:     ui.RGBA(245, 101, 132, 0.17),
		DangerBorder:   ui.RGBA(245, 101, 132, 0.44),
		MeterTrack:     ui.RGBA(255, 255, 255, 0.22),
		Hairline:       ui.RGBA(255, 255, 255, 0.1),
	}
}
