package view

import (
	"bytes"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/nocoo/mico/apps/macos/internal/bridge"
	"github.com/nocoo/mico/apps/macos/internal/permissions"
	"github.com/nocoo/mico/apps/macos/internal/theme"
	"github.com/nocoo/mico/apps/macos/modules/audiocapture"
)

func saveSnapshotIfRequested(t *testing.T, name string, tester *ui.Tester) {
	t.Helper()
	dir := os.Getenv("MICO_VIEW_SNAPSHOT_DIR")
	if dir == "" {
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir snapshot dir: %v", err)
	}
	img := tester.Image()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode snapshot %s: %v", name, err)
	}
	if err := os.WriteFile(filepath.Join(dir, name+".png"), buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write snapshot %s: %v", name, err)
	}
}

func TestTrayIconsDecodeAsRetinaPNG(t *testing.T) {
	for name, raw := range map[string][]byte{
		"idle":      TrayIconIdlePNG(),
		"streaming": TrayIconStreamingPNG(),
	} {
		img, err := png.Decode(bytes.NewReader(raw))
		if err != nil {
			t.Fatalf("%s tray icon invalid png: %v", name, err)
		}
		if img.Bounds().Dx() != 36 || img.Bounds().Dy() != 36 {
			t.Fatalf("%s tray icon expected 36x36, got %v", name, img.Bounds())
		}
	}
}

func TestFlyoutStatesAndActions(t *testing.T) {
	devices := []audiocapture.InputDevice{
		{ID: "built-in", Name: "MacBook Pro Microphone", IsDefault: true},
		{ID: "usb-mic", Name: "Studio USB Mic", IsDefault: false},
	}

	t.Run("setup-light-and-dark", func(t *testing.T) {
		var opened bool
		state := FlyoutState{
			ThemeMode:  theme.ModeLight,
			SystemDark: false,
			Permissions: permissions.Snapshot{
				Microphone:  permissions.StatusGranted,
				SystemAudio: permissions.StatusUnknown,
			},
			Devices: devices,
		}
		tester := ui.NewTester(func(c *ui.Context) {
			RenderFlyout(c, state, FlyoutActions{
				OnOpenPermissions: func() { opened = true },
			})
		}, FlyoutWidth, 430)

		if !tester.HasText("Finish audio setup") {
			t.Fatalf("expected setup heading, got texts: %v", tester.Texts())
		}
		saveSnapshotIfRequested(t, "flyout-setup-light", tester)
		if err := tester.Click("Open Permission Guide"); err != nil {
			t.Fatalf("click Open Permission Guide: %v", err)
		}
		if !opened {
			t.Fatalf("expected OnOpenPermissions callback")
		}

		state.ThemeMode = theme.ModeDark
		tester.Frame()
		saveSnapshotIfRequested(t, "flyout-setup-dark", tester)
	})

	t.Run("streaming-dark-and-stop", func(t *testing.T) {
		var stopped bool
		var pickedTheme theme.Mode
		now := time.Date(2026, 11, 20, 14, 20, 0, 0, time.UTC)
		state := FlyoutState{
			ThemeMode:  theme.ModeDark,
			SystemDark: true,
			Permissions: permissions.Snapshot{
				Microphone:  permissions.StatusGranted,
				SystemAudio: permissions.StatusGranted,
			},
			Bridge: bridge.Status{
				Capturing:  true,
				AudioLevel: 0.62,
				StartedAt:  now.Add(-125 * time.Second),
				DeviceName: "MacBook Pro Microphone",
			},
			Devices: devices,
			Now:     now,
		}
		tester := ui.NewTester(func(c *ui.Context) {
			RenderFlyout(c, state, FlyoutActions{
				OnStopStreaming: func() { stopped = true },
				OnThemeChange:   func(m theme.Mode) { pickedTheme = m },
			})
		}, FlyoutWidth, 420)

		if !tester.HasText("Streaming to Mico Live") || !tester.HasText("02:05") {
			t.Fatalf("expected streaming state + 02:05 elapsed, got: %v", tester.Texts())
		}
		saveSnapshotIfRequested(t, "flyout-streaming-dark", tester)

		if err := tester.Click("Stop streaming"); err != nil {
			t.Fatalf("click Stop streaming: %v", err)
		}
		if !stopped {
			t.Fatalf("expected OnStopStreaming callback")
		}
		if err := tester.Click("Light"); err != nil {
			t.Fatalf("click Light theme segment: %v", err)
		}
		if pickedTheme != theme.ModeLight {
			t.Fatalf("expected ModeLight, got %v", pickedTheme)
		}
	})

	t.Run("ready-light-and-dark", func(t *testing.T) {
		state := FlyoutState{
			ThemeMode:  theme.ModeLight,
			SystemDark: false,
			Permissions: permissions.Snapshot{
				Microphone:  permissions.StatusGranted,
				SystemAudio: permissions.StatusGranted,
			},
			Devices: devices,
		}
		tester := ui.NewTester(func(c *ui.Context) {
			RenderFlyout(c, state, FlyoutActions{})
		}, FlyoutWidth, 430)

		if !tester.HasText("Ready for Mico Live") {
			t.Fatalf("expected Ready heading, got: %v", tester.Texts())
		}
		saveSnapshotIfRequested(t, "flyout-ready-light", tester)

		state.ThemeMode = theme.ModeDark
		state.SystemDark = true
		tester.Frame()
		saveSnapshotIfRequested(t, "flyout-ready-dark", tester)
	})
}

func TestPermissionGuideStatesAndActions(t *testing.T) {
	var micRequested, sysGuided, relaunched bool
	state := GuideState{
		ThemeMode:  theme.ModeDark,
		SystemDark: true,
		Permissions: permissions.Snapshot{
			Microphone:      permissions.StatusUnknown,
			SystemAudio:     permissions.StatusDenied,
			NeedsReopenHint: true,
		},
	}
	tester := ui.NewTester(func(c *ui.Context) {
		RenderPermissionGuide(c, state, GuideActions{
			OnRequestMic:       func() { micRequested = true },
			OnGuideSystemAudio: func() { sysGuided = true },
			OnRelaunch:         func() { relaunched = true },
		})
	}, GuideWidth, GuideHeight)

	if !tester.HasText("2 permissions needed") || !tester.HasText("Already enabled in System Settings?") {
		t.Fatalf("expected setup + recovery card, got: %v", tester.Texts())
	}
	saveSnapshotIfRequested(t, "guide-setup-dark", tester)

	if err := tester.Click("Allow Microphone"); err != nil {
		t.Fatalf("click Allow Microphone: %v", err)
	}
	if err := tester.Click("Guided Setup"); err != nil {
		t.Fatalf("click Guided Setup: %v", err)
	}
	if err := tester.Click("Reopen Mico Helper"); err != nil {
		t.Fatalf("click Reopen Mico Helper: %v", err)
	}
	if !micRequested || !sysGuided || !relaunched {
		t.Fatalf("expected callbacks mic=%v guide=%v relaunch=%v", micRequested, sysGuided, relaunched)
	}

	state.ThemeMode = theme.ModeLight
	state.Permissions = permissions.Snapshot{
		Microphone:  permissions.StatusGranted,
		SystemAudio: permissions.StatusGranted,
	}
	tester.Frame()
	if !tester.HasText("All set — ready for Mico Live") {
		t.Fatalf("expected all-granted banner, got: %v", tester.Texts())
	}
	saveSnapshotIfRequested(t, "guide-ready-light", tester)
}
