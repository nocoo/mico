package view

import (
	"fmt"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/nocoo/mico/apps/macos/internal/bridge"
	"github.com/nocoo/mico/apps/macos/internal/permissions"
	"github.com/nocoo/mico/apps/macos/internal/theme"
	"github.com/nocoo/mico/apps/macos/modules/audiocapture"
)

const FlyoutWidth = 328

type FlyoutState struct {
	ThemeMode        theme.Mode
	SystemDark       bool
	Permissions      permissions.Snapshot
	Bridge           bridge.Status
	Devices          []audiocapture.InputDevice
	SelectedDeviceID string
	Now              time.Time
}

type FlyoutActions struct {
	OnOpenPermissions func()
	OnStopStreaming   func()
	OnSelectDevice    func(deviceID string)
	OnThemeChange     func(mode theme.Mode)
	OnRefresh         func()
	OnQuit            func()
}

func RenderFlyout(c *ui.Context, state FlyoutState, actions FlyoutActions) {
	tokens := theme.Resolve(state.ThemeMode, state.SystemDark)
	c.SetTheme(tokens.Theme)
	c.Root().Background(tokens.Theme.Background)

	ui.Column(c).
		Width(FlyoutWidth).
		Background(tokens.Theme.Background).
		Border(1, tokens.CardBorder).
		Radius(14).
		Padding(14).
		Gap(12).
		Children(func() {
			renderFlyoutHeader(c, state, tokens)
			renderFlyoutHero(c, state, actions, tokens)
			renderMicrophoneCard(c, state, actions, tokens)
			renderFlyoutFooter(c, state, actions, tokens)
		})
}

func renderFlyoutHeader(c *ui.Context, state FlyoutState, tokens theme.Tokens) {
	ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(10).Children(func() {
		renderBrandBadge(c, 30, tokens)

		ui.Column(c).Grow(1).Gap(1).Children(func() {
			ui.Text(c, "Mico Helper").FontSize(13.5).Bold().TextColor(tokens.Theme.Text)
			ui.Text(c, "Local meeting audio").FontSize(11).TextColor(tokens.Theme.TextMuted)
		})

		label, fg, bg := statusPillStyle(state, tokens)
		renderStatusPill(c, label, fg, bg)
	})
}

func renderBrandBadge(c *ui.Context, size float32, tokens theme.Tokens) {
	ui.Box(c).
		Size(size, size).
		Radius(size * 0.28).
		Gradient(tokens.AccentHi, tokens.AccentLo, 135).
		Center().
		Children(func() {
			ui.Icon(c, IconWave).Size(size*0.56, size*0.56).TextColor(tokens.Theme.AccentText)
		})
}

func statusPillStyle(state FlyoutState, tokens theme.Tokens) (string, ui.Color, ui.Color) {
	if state.Permissions.NeedsSetup() {
		return "Setup", tokens.Theme.Warning, tokens.WarningSoft
	}
	if state.Bridge.Capturing {
		return "Live", tokens.Theme.Success, tokens.SuccessSoft
	}
	return "Ready", tokens.Theme.Accent, tokens.AccentSoft
}

func renderStatusPill(c *ui.Context, label string, fg, bg ui.Color) {
	ui.Row(c).
		AlignItems(ui.Center).
		Gap(5).
		Padding(4, 9).
		Radius(999).
		Background(bg).
		Children(func() {
			ui.Box(c).Size(6, 6).Radius(999).Background(fg)
			ui.Text(c, label).FontSize(11).FontWeight(600).TextColor(fg)
		})
}

func renderFlyoutHero(c *ui.Context, state FlyoutState, actions FlyoutActions, tokens theme.Tokens) {
	if state.Permissions.NeedsSetup() {
		ui.Column(c).
			FillWidth().
			Background(tokens.CardBg).
			Border(1, tokens.CardBorder).
			Radius(12).
			Padding(12).
			Gap(10).
			Children(func() {
				ui.Row(c).AlignItems(ui.Center).Gap(7).Children(func() {
					ui.Icon(c, IconShield).Size(15, 15).TextColor(tokens.Theme.Warning)
					ui.Text(c, "Finish audio setup").FontSize(13).Bold().TextColor(tokens.Theme.Text)
				})
				ui.Text(c, "Allow Microphone and System Audio so Mico Live captures both sides of meetings.").
					FontSize(12).
					LineHeight(1.4).
					TextColor(tokens.Theme.TextMuted)

				ui.Row(c).FillWidth().Gap(8).Children(func() {
					renderMiniPermChip(c, "Microphone", state.Permissions.Microphone == permissions.StatusGranted, tokens)
					renderMiniPermChip(c, "System audio", state.Permissions.SystemAudio == permissions.StatusGranted, tokens)
				})

				if ui.PrimaryButton(c, "Open Permission Guide").FillWidth().Clicked() && actions.OnOpenPermissions != nil {
					actions.OnOpenPermissions()
				}
			})
		return
	}

	if state.Bridge.Capturing {
		now := state.Now
		if now.IsZero() {
			now = time.Now()
		}
		elapsed := time.Duration(0)
		if !state.Bridge.StartedAt.IsZero() && now.After(state.Bridge.StartedAt) {
			elapsed = now.Sub(state.Bridge.StartedAt)
		}

		ui.Column(c).
			FillWidth().
			Background(tokens.CardBg).
			Border(1, tokens.SuccessBorder).
			Radius(12).
			Padding(12).
			Gap(10).
			Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Children(func() {
					ui.Row(c).AlignItems(ui.Center).Gap(7).Grow(1).Children(func() {
						ui.Box(c).Size(8, 8).Radius(999).Background(tokens.Theme.Success)
						ui.Text(c, "Streaming to Mico Live").FontSize(13).Bold().TextColor(tokens.Theme.Text)
					})
					ui.Text(c, formatElapsed(elapsed)).FontSize(12).FontWeight(600).TextColor(tokens.Theme.Success)
				})

				ui.Meter(c, state.Bridge.AudioLevel, 0, 1, &ui.MeterLevels{
					NormalColor:   tokens.Theme.Accent,
					Warning:       0.78,
					Critical:      0.94,
					WarningColor:  tokens.Theme.Warning,
					CriticalColor: tokens.Theme.Danger,
				}).
					FillWidth().
					Height(7).
					Background(tokens.MeterTrack).
					Radius(4).
					Label("Live audio level")

				ui.Text(c, "Mic + System audio · 16 kHz PCM").
					FontSize(11.5).
					TextColor(tokens.Theme.TextMuted)

				stopBtn := ui.Button(c, "Stop streaming").
					FillWidth().
					Background(tokens.DangerSoft).
					Border(1, tokens.DangerBorder).
					TextColor(tokens.Theme.Danger)
				if stopBtn.Clicked() && actions.OnStopStreaming != nil {
					actions.OnStopStreaming()
				}
			})
		return
	}

	ui.Column(c).
		FillWidth().
		Background(tokens.CardBg).
		Border(1, tokens.CardBorder).
		Radius(12).
		Padding(12).
		Gap(8).
		Children(func() {
			ui.Row(c).AlignItems(ui.Center).Gap(7).Children(func() {
				ui.Icon(c, IconCheck).Size(14, 14).TextColor(tokens.Theme.Success)
				ui.Text(c, "Ready for Mico Live").FontSize(13).Bold().TextColor(tokens.Theme.Text)
			})
			ui.Text(c, "Start Live in Mico — your microphone and meeting audio connect automatically.").
				FontSize(12).
				LineHeight(1.4).
				TextColor(tokens.Theme.TextMuted)
			ui.Row(c).AlignItems(ui.Center).Gap(6).Padding(4, 8).Radius(7).Background(tokens.WellBg).Children(func() {
				ui.Text(c, "Mic + System audio").FontSize(11).FontWeight(600).TextColor(tokens.Theme.Accent)
				ui.Text(c, "·").FontSize(11).TextColor(tokens.Theme.TextMuted)
				ui.Text(c, "Local loopback").FontSize(11).TextColor(tokens.Theme.TextMuted)
			})
		})
}

func renderMiniPermChip(c *ui.Context, label string, granted bool, tokens theme.Tokens) {
	fg := tokens.Theme.Warning
	bg := tokens.WarningSoft
	if granted {
		fg = tokens.Theme.Success
		bg = tokens.SuccessSoft
	}
	ui.Row(c).
		Grow(1).
		AlignItems(ui.Center).
		Justify(ui.Center).
		Gap(5).
		Padding(5, 8).
		Radius(8).
		Background(bg).
		Children(func() {
			if granted {
				ui.Icon(c, IconCheck).Size(12, 12).TextColor(fg)
			} else {
				ui.Box(c).Size(6, 6).Radius(999).Background(fg)
			}
			ui.Text(c, label).FontSize(11).FontWeight(600).TextColor(fg)
		})
}

func renderMicrophoneCard(c *ui.Context, state FlyoutState, actions FlyoutActions, tokens theme.Tokens) {
	options, labelToID, currentLabel := buildDeviceOptions(state.Devices, state.SelectedDeviceID)

	ui.Column(c).
		FillWidth().
		Background(tokens.CardBg).
		Border(1, tokens.CardBorder).
		Radius(12).
		Padding(11, 12).
		Gap(8).
		Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Children(func() {
				ui.Row(c).AlignItems(ui.Center).Gap(6).Grow(1).Children(func() {
					ui.Icon(c, IconMic).Size(13, 13).TextColor(tokens.Theme.TextMuted)
					ui.Text(c, "Microphone").FontSize(11.5).FontWeight(600).TextColor(tokens.Theme.TextMuted)
				})
				refresh := ui.Button(c, "").
					Padding(4, 6).
					Radius(6).
					Tooltip("Refresh audio devices").
					Label("Refresh audio devices").
					Children(func() {
						ui.Icon(c, IconRefresh).Size(12, 12).TextColor(tokens.Theme.TextMuted)
					})
				if refresh.Clicked() && actions.OnRefresh != nil {
					actions.OnRefresh()
				}
			})

			selected := currentLabel
			sel := ui.Select(c, &selected, options).FillWidth().Label("Microphone")
			if sel.Changed() && actions.OnSelectDevice != nil {
				actions.OnSelectDevice(labelToID[selected])
			}

			if state.Bridge.Capturing {
				ui.Text(c, "Device changes apply to the next Live session.").
					FontSize(11).
					TextColor(tokens.Theme.TextMuted)
			}
		})
}

func renderFlyoutFooter(c *ui.Context, state FlyoutState, actions FlyoutActions, tokens theme.Tokens) {
	ui.Column(c).FillWidth().Gap(10).Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
			ui.Text(c, "Theme").FontSize(12).FontWeight(500).TextColor(tokens.Theme.TextMuted)
			ui.Spacer(c)
			seg := int(state.ThemeMode)
			ctrl := ui.Segmented(c, &seg, "Auto", "Light", "Dark").Label("Theme")
			if ctrl.Changed() && actions.OnThemeChange != nil {
				actions.OnThemeChange(theme.Mode(seg))
			}
		})

		ui.Box(c).FillWidth().Height(1).Background(tokens.Hairline)

		ui.Row(c).FillWidth().AlignItems(ui.Center).Children(func() {
			if ui.Button(c, "Permissions").Clicked() && actions.OnOpenPermissions != nil {
				actions.OnOpenPermissions()
			}
			ui.Spacer(c)
			if ui.Button(c, "Quit").Clicked() && actions.OnQuit != nil {
				actions.OnQuit()
			}
		})
	})
}

func buildDeviceOptions(devices []audiocapture.InputDevice, selectedID string) ([]string, map[string]string, string) {
	defaultName := "System Default"
	for _, d := range devices {
		if d.IsDefault && d.Name != "" {
			defaultName = d.Name
			break
		}
	}
	autoLabel := fmt.Sprintf("Automatic (%s)", defaultName)
	options := []string{autoLabel}
	labelToID := map[string]string{autoLabel: ""}
	currentLabel := autoLabel

	seen := map[string]int{autoLabel: 1}
	for _, d := range devices {
		label := d.Name
		if label == "" {
			label = d.ID
		}
		if seen[label] > 0 {
			seen[label]++
			label = fmt.Sprintf("%s (%d)", label, seen[label])
		} else {
			seen[label] = 1
		}
		options = append(options, label)
		labelToID[label] = d.ID
		if selectedID != "" && d.ID == selectedID {
			currentLabel = label
		}
	}
	return options, labelToID, currentLabel
}

func formatElapsed(d time.Duration) string {
	total := int(d.Seconds())
	if total < 0 {
		total = 0
	}
	mins := total / 60
	secs := total % 60
	return fmt.Sprintf("%02d:%02d", mins, secs)
}
