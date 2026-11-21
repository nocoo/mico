package view

import (
	"fmt"

	"github.com/egoist/mygo/ui"
	"github.com/nocoo/mico/apps/macos/internal/permissions"
	"github.com/nocoo/mico/apps/macos/internal/theme"
)

const (
	GuideWidth  = 512
	GuideHeight = 696
)

type GuideState struct {
	ThemeMode   theme.Mode
	SystemDark  bool
	Permissions permissions.Snapshot
}

type GuideActions struct {
	OnRequestMic         func()
	OnOpenMicSettings    func()
	OnGuideSystemAudio   func()
	OnVerifySystemAudio  func()
	OnOpenSystemSettings func()
	OnRefresh            func()
	OnRelaunch           func()
	OnDone               func()
}

func RenderPermissionGuide(c *ui.Context, state GuideState, actions GuideActions) {
	tokens := theme.Resolve(state.ThemeMode, state.SystemDark)
	c.SetTheme(tokens.Theme)
	c.Root().Background(tokens.Theme.Background)

	tb := c.TitleBar()
	topInset := float32(18)
	if tb.Bottom > 0 {
		topInset = max(tb.Bottom+12, 40)
	}

	ui.Column(c).
		Fill().
		LinearGradient(tokens.BgGradient).
		Children(func() {
			if tb.Bottom > 0 {
				ui.Box(c).FillWidth().Height(topInset).DragWindow()
			}

			ui.Column(c).
				FillWidth().
				Grow(1).
				Padding(0, 22, 18, 22).
				Gap(13).
				Children(func() {
					if tb.Bottom <= 0 {
						ui.Box(c).Height(18)
					}
					renderGuideHeader(c, tokens)

					ui.Scroll(c).FillWidth().Grow(1).Children(func() {
						ui.Column(c).FillWidth().Gap(12).Padding(0, 2, 6, 0).Children(func() {
							renderReadinessBanner(c, state.Permissions, tokens)
							renderMicrophoneStep(c, state.Permissions, actions, tokens)
							renderSystemAudioStep(c, state.Permissions, actions, tokens)
							if state.Permissions.SystemAudio != permissions.StatusGranted && state.Permissions.NeedsReopenHint {
								renderReopenRecoveryCard(c, state.Permissions, actions, tokens)
							}
						})
					})

					ui.Box(c).FillWidth().Height(1).Background(tokens.Hairline)
					renderGuideFooter(c, state.Permissions, actions, tokens)
				})
		})
}

func renderGuideHeader(c *ui.Context, tokens theme.Tokens) {
	ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(13).DragWindow().Children(func() {
		renderBrandBadge(c, 46, tokens)
		ui.Column(c).Grow(1).Gap(3).Children(func() {
			ui.Text(c, "Mico Helper Audio Setup").FontSize(18).Bold().TextColor(tokens.Theme.Text)
			ui.Text(c, "Grant local access once so Mico Live captures both your voice and meeting audio with zero browser prompts.").
				FontSize(12.5).
				LineHeight(1.4).
				TextColor(tokens.Theme.TextMuted)
		})
	})
}

func renderReadinessBanner(c *ui.Context, snap permissions.Snapshot, tokens theme.Tokens) {
	if snap.AllGranted() {
		ui.Row(c).
			FillWidth().
			AlignItems(ui.Center).
			Gap(11).
			Padding(13, 14).
			Radius(14).
			LinearGradient(tokens.HeroLive).
			Border(1, tokens.HeroChipBorder).
			Shadow(0, 10, 22, -10, tokens.HeroShadow).
			Children(func() {
				ui.Box(c).
					Size(30, 30).
					Radius(999).
					Background(tokens.HeroChipBg).
					Center().
					Children(func() {
						ui.Icon(c, IconCheck).Size(16, 16).TextColor(tokens.HeroText)
					})
				ui.Column(c).Grow(1).Gap(2).Children(func() {
					ui.Text(c, "All set — ready for Mico Live").FontSize(13.5).Bold().TextColor(tokens.HeroText)
					ui.Text(c, "Return to Mico in your browser. Live mode connects to Mico Helper automatically.").
						FontSize(12).
						TextColor(tokens.HeroSubtext)
				})
			})
		return
	}

	missing := snap.MissingCount()
	title := "1 permission remaining"
	if missing > 1 {
		title = fmt.Sprintf("%d permissions needed", missing)
	}
	granted := 2 - missing

	ui.Row(c).
		FillWidth().
		AlignItems(ui.Center).
		Gap(11).
		Padding(13, 14).
		Radius(14).
		LinearGradient(tokens.HeroReady).
		Border(1, tokens.HeroChipBorder).
		Shadow(0, 10, 22, -10, tokens.HeroShadow).
		Children(func() {
			ui.Box(c).
				Size(30, 30).
				Radius(999).
				Background(tokens.HeroChipBg).
				Center().
				Children(func() {
					ui.Icon(c, IconShield).Size(15, 15).TextColor(tokens.HeroText)
				})
			ui.Column(c).Grow(1).Gap(2).Children(func() {
				ui.Text(c, title).FontSize(13.5).Bold().TextColor(tokens.HeroText)
				ui.Text(c, "Audio stays on this Mac and streams only while you run Live in Mico.").
					FontSize(12).
					TextColor(tokens.HeroSubtext)
			})
			ui.Box(c).
				Padding(4, 9).
				Radius(999).
				Background(tokens.HeroChipBg).
				Border(1, tokens.HeroChipBorder).
				Children(func() {
					ui.Text(c, fmt.Sprintf("%d / 2", granted)).FontSize(11).FontWeight(600).TextColor(tokens.HeroText)
				})
		})
}

func renderMicrophoneStep(c *ui.Context, snap permissions.Snapshot, actions GuideActions, tokens theme.Tokens) {
	ui.Column(c).
		FillWidth().
		Background(tokens.CardBg).
		Border(1, tokens.CardBorder).
		Radius(14).
		Padding(14).
		Gap(11).
		Shadow(0, 6, 18, -8, tokens.CardShadow).
		Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(11).Children(func() {
				renderStepIcon(c, IconMic, snap.Microphone == permissions.StatusGranted, tokens)
				ui.Column(c).Grow(1).Gap(2).Children(func() {
					ui.Text(c, "1. Microphone").FontSize(13.5).Bold().TextColor(tokens.Theme.Text)
					ui.Text(c, "Captures your voice from your chosen Mac microphone.").
						FontSize(12).
						TextColor(tokens.Theme.TextMuted)
				})
				renderPermBadge(c, snap.Microphone, "Not allowed", tokens)
			})

			if snap.Microphone != permissions.StatusGranted {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
					if snap.Microphone == permissions.StatusDenied {
						if ui.PrimaryButton(c, "Open Microphone Settings").Clicked() && actions.OnOpenMicSettings != nil {
							actions.OnOpenMicSettings()
						}
					} else {
						label := "Allow Microphone"
						if snap.RequestingMic {
							label = "Requesting..."
						}
						btn := ui.PrimaryButton(c, label).Disabled(snap.RequestingMic)
						if btn.Clicked() && actions.OnRequestMic != nil {
							actions.OnRequestMic()
						}
						if ui.Button(c, "Open Settings").Clicked() && actions.OnOpenMicSettings != nil {
							actions.OnOpenMicSettings()
						}
					}
				})
			}
		})
}

func renderSystemAudioStep(c *ui.Context, snap permissions.Snapshot, actions GuideActions, tokens theme.Tokens) {
	ui.Column(c).
		FillWidth().
		Background(tokens.CardBg).
		Border(1, tokens.CardBorder).
		Radius(14).
		Padding(14).
		Gap(11).
		Shadow(0, 6, 18, -8, tokens.CardShadow).
		Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(11).Children(func() {
				renderStepIcon(c, IconSpeaker, snap.SystemAudio == permissions.StatusGranted, tokens)
				ui.Column(c).Grow(1).Gap(2).Children(func() {
					ui.Text(c, "2. System Audio").FontSize(13.5).Bold().TextColor(tokens.Theme.Text)
					ui.Text(c, "Uses macOS Screen & System Audio Recording to capture meeting participants. No screen video is recorded.").
						FontSize(12).
						LineHeight(1.38).
						TextColor(tokens.Theme.TextMuted)
				})
				renderPermBadge(c, snap.SystemAudio, "Not verified", tokens)
			})

			if snap.SystemIssue != "" {
				ui.Text(c, snap.SystemIssue).
					FontSize(11.5).
					TextColor(tokens.Theme.Warning)
			}

			if snap.SystemAudio != permissions.StatusGranted {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
					guideLabel := "Guided Setup"
					if snap.Guiding {
						guideLabel = "Guiding..."
					}
					guideBtn := ui.PrimaryButton(c, guideLabel).Disabled(snap.Guiding)
					if guideBtn.Clicked() && actions.OnGuideSystemAudio != nil {
						actions.OnGuideSystemAudio()
					}

					verifyLabel := "Verify Access"
					if snap.RequestingSystem {
						verifyLabel = "Checking..."
					}
					verifyBtn := ui.Button(c, verifyLabel).Disabled(snap.RequestingSystem)
					if verifyBtn.Clicked() && actions.OnVerifySystemAudio != nil {
						actions.OnVerifySystemAudio()
					}

					if ui.Button(c, "Open Settings").Clicked() && actions.OnOpenSystemSettings != nil {
						actions.OnOpenSystemSettings()
					}
				})
			}
		})
}

func renderReopenRecoveryCard(c *ui.Context, snap permissions.Snapshot, actions GuideActions, tokens theme.Tokens) {
	ui.Column(c).
		FillWidth().
		LinearGradient(tokens.HeroSetup).
		Border(1, tokens.WarningBorder).
		Radius(14).
		Padding(13).
		Gap(9).
		Shadow(0, 6, 16, -8, tokens.CardShadow).
		Children(func() {
			ui.Row(c).AlignItems(ui.Center).Gap(8).Children(func() {
				ui.Icon(c, IconAlert).Size(15, 15).TextColor(tokens.Theme.Warning)
				ui.Text(c, "Already enabled in System Settings?").FontSize(13).Bold().TextColor(tokens.Theme.Text)
			})
			ui.Text(c, "macOS can keep an older permission state until Mico Helper reopens. Verify again or reopen once to apply.").
				FontSize(12).
				LineHeight(1.38).
				TextColor(tokens.Theme.TextMuted)

			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				verifyLabel := "Verify Again"
				if snap.RequestingSystem {
					verifyLabel = "Checking..."
				}
				if ui.Button(c, verifyLabel).Disabled(snap.RequestingSystem).Clicked() && actions.OnVerifySystemAudio != nil {
					actions.OnVerifySystemAudio()
				}
				if ui.PrimaryButton(c, "Reopen Mico Helper").Clicked() && actions.OnRelaunch != nil {
					actions.OnRelaunch()
				}
			})
		})
}

func renderGuideFooter(c *ui.Context, snap permissions.Snapshot, actions GuideActions, tokens theme.Tokens) {
	ui.Row(c).FillWidth().AlignItems(ui.Center).Children(func() {
		if ui.Button(c, "Refresh Status").Clicked() && actions.OnRefresh != nil {
			actions.OnRefresh()
		}
		ui.Spacer(c)
		if snap.AllGranted() {
			if ui.PrimaryButton(c, "Done").Clicked() && actions.OnDone != nil {
				actions.OnDone()
			}
		} else {
			if ui.Button(c, "Close").Clicked() && actions.OnDone != nil {
				actions.OnDone()
			}
		}
	})
}

func renderStepIcon(c *ui.Context, icon *ui.SVG, granted bool, tokens theme.Tokens) {
	bg := tokens.AccentSoft
	fg := tokens.Theme.Accent
	if granted {
		bg = tokens.SuccessSoft
		fg = tokens.Theme.Success
	}
	ui.Box(c).
		Size(34, 34).
		Radius(10).
		Background(bg).
		Center().
		Children(func() {
			ui.Icon(c, icon).Size(16, 16).TextColor(fg)
		})
}

func renderPermBadge(c *ui.Context, st permissions.Status, unknownLabel string, tokens theme.Tokens) {
	switch st {
	case permissions.StatusGranted:
		renderStatusPill(c, "Granted", tokens.Theme.Success, tokens.SuccessSoft)
	case permissions.StatusDenied:
		renderStatusPill(c, "Denied", tokens.Theme.Danger, tokens.DangerSoft)
	default:
		renderStatusPill(c, unknownLabel, tokens.Theme.Warning, tokens.WarningSoft)
	}
}
