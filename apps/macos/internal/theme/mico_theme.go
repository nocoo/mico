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
	Theme       *ui.Theme
	Dark        bool
	CardBg      ui.Color
	CardBorder  ui.Color
	WellBg      ui.Color
	AccentSoft  ui.Color
	AccentHi    ui.Color
	AccentLo    ui.Color
	SuccessSoft   ui.Color
	SuccessBorder ui.Color
	WarningSoft   ui.Color
	WarningBorder ui.Color
	DangerSoft    ui.Color
	DangerBorder  ui.Color
	MeterTrack    ui.Color
	Hairline      ui.Color
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
	t.Background = ui.Hex("#f5f7fc")
	t.Surface = ui.Hex("#ffffff")
	t.SurfaceHover = ui.Hex("#eef1fb")
	t.SurfacePressed = ui.Hex("#e3e7f7")
	t.Border = ui.Hex("#dde2f2")
	t.Text = ui.Hex("#25293a")
	t.TextMuted = ui.Hex("#636b84")
	t.Accent = ui.Hex("#6c5ce7")
	t.AccentHover = ui.Hex("#5c4bd9")
	t.AccentPressed = ui.Hex("#4d3cc4")
	t.AccentText = ui.Hex("#ffffff")
	t.InactiveAccent = ui.Hex("#6c5ce7")
	t.Success = ui.Hex("#2f9e59")
	t.Warning = ui.Hex("#c97e12")
	t.Danger = ui.Hex("#cf3a5c")
	t.Focus = ui.RGBA(108, 92, 231, 0.45)
	t.Selection = ui.RGBA(108, 92, 231, 0.16)
	t.Radius = 10
	t.Spacing = 4
	t.FontSize = 13

	return Tokens{
		Theme:       t,
		Dark:        false,
		CardBg:      ui.RGBA(255, 255, 255, 0.88),
		CardBorder:  ui.RGBA(104, 114, 160, 0.18),
		WellBg:      ui.RGBA(108, 92, 231, 0.06),
		AccentSoft:  ui.RGBA(108, 92, 231, 0.12),
		AccentHi:    ui.Hex("#887bf2"),
		AccentLo:    ui.Hex("#5746d6"),
		SuccessSoft:   ui.RGBA(47, 158, 89, 0.12),
		SuccessBorder: ui.RGBA(47, 158, 89, 0.34),
		WarningSoft:   ui.RGBA(201, 126, 18, 0.13),
		WarningBorder: ui.RGBA(201, 126, 18, 0.34),
		DangerSoft:    ui.RGBA(207, 58, 92, 0.11),
		DangerBorder:  ui.RGBA(207, 58, 92, 0.36),
		MeterTrack:    ui.RGBA(104, 114, 160, 0.16),
		Hairline:      ui.RGBA(104, 114, 160, 0.15),
	}
}

func darkTokens() Tokens {
	t := ui.DarkTheme()
	t.Background = ui.Hex("#11131f")
	t.Surface = ui.Hex("#1b1e30")
	t.SurfaceHover = ui.Hex("#242840")
	t.SurfacePressed = ui.Hex("#2d3250")
	t.Border = ui.Hex("#2e3350")
	t.Text = ui.Hex("#f1f3fb")
	t.TextMuted = ui.Hex("#99a1be")
	t.Accent = ui.Hex("#8577ff")
	t.AccentHover = ui.Hex("#968aff")
	t.AccentPressed = ui.Hex("#6f60ec")
	t.AccentText = ui.Hex("#ffffff")
	t.InactiveAccent = ui.Hex("#8577ff")
	t.Success = ui.Hex("#43c977")
	t.Warning = ui.Hex("#f0b23d")
	t.Danger = ui.Hex("#f25f7e")
	t.Focus = ui.RGBA(133, 119, 255, 0.55)
	t.Selection = ui.RGBA(133, 119, 255, 0.24)
	t.Radius = 10
	t.Spacing = 4
	t.FontSize = 13

	return Tokens{
		Theme:       t,
		Dark:        true,
		CardBg:      ui.RGBA(27, 30, 48, 0.86),
		CardBorder:  ui.RGBA(255, 255, 255, 0.11),
		WellBg:      ui.RGBA(255, 255, 255, 0.06),
		AccentSoft:  ui.RGBA(133, 119, 255, 0.2),
		AccentHi:    ui.Hex("#9c90ff"),
		AccentLo:    ui.Hex("#6c5ce7"),
		SuccessSoft:   ui.RGBA(67, 201, 119, 0.16),
		SuccessBorder: ui.RGBA(67, 201, 119, 0.38),
		WarningSoft:   ui.RGBA(240, 178, 61, 0.14),
		WarningBorder: ui.RGBA(240, 178, 61, 0.36),
		DangerSoft:    ui.RGBA(242, 95, 126, 0.16),
		DangerBorder:  ui.RGBA(242, 95, 126, 0.42),
		MeterTrack:    ui.RGBA(255, 255, 255, 0.1),
		Hairline:      ui.RGBA(255, 255, 255, 0.1),
	}
}
