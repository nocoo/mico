package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/nocoo/mico/apps/macos/internal/bridge"
	"github.com/nocoo/mico/apps/macos/internal/permissions"
	"github.com/nocoo/mico/apps/macos/internal/theme"
	"github.com/nocoo/mico/apps/macos/internal/view"
	"github.com/nocoo/mico/apps/macos/modules/audiocapture"
)

const appVersion = "0.1.0"

type persistedPrefs struct {
	ThemeMode        string `json:"themeMode"`
	SelectedDeviceID string `json:"selectedDeviceId"`
}

type helperApp struct {
	mu               sync.RWMutex
	themeMode        theme.Mode
	systemDark       bool
	selectedDeviceID string
	devices          []audiocapture.InputDevice
	permSnap         permissions.Snapshot
	bridgeStatus     bridge.Status

	engine   audiocapture.Engine
	perms    *permissions.Manager
	server   *bridge.Server
	tray     *mygo.Tray
	flyout   *mygo.Window
	guideWin *mygo.Window

	idleIcon      []byte
	streamingIcon []byte
	stopBg        chan struct{}
}

func newHelperApp() *helperApp {
	eng, err := audiocapture.NewEngine()
	if err != nil {
		log.Printf("mico-helper native audio engine unavailable: %v", err)
	}
	a := &helperApp{
		themeMode:     theme.ModeSystem,
		engine:        eng,
		idleIcon:      view.TrayIconIdlePNG(),
		streamingIcon: view.TrayIconStreamingPNG(),
		stopBg:        make(chan struct{}),
	}

	a.perms = permissions.NewManager(permissions.SystemBackend{Engine: a.engine}, func(snap permissions.Snapshot) {
		a.mu.Lock()
		a.permSnap = snap
		a.mu.Unlock()
		mygo.RunOnMain(func() {
			a.syncTrayAppearance()
			a.invalidateWindows()
		})
	})

	addr := bridge.DefaultAddr
	if port := strings.TrimSpace(os.Getenv("MICO_HELPER_PORT")); port != "" {
		addr = "127.0.0.1:" + port
	}
	policy := bridge.NewOriginPolicy(os.Getenv("MICO_HELPER_ALLOWED_ORIGINS"))

	a.server = bridge.NewServer(bridge.Config{
		Addr:           addr,
		Version:        appVersion,
		OriginPolicy:   policy,
		Engine:         a.engine,
		Permissions:    a.perms,
		SelectedDevice: a.effectiveDevice,
		OnOpenPermissions: func() {
			mygo.RunOnMain(a.openPermissionGuide)
		},
		OnStateChange: func(st bridge.Status) {
			a.mu.Lock()
			a.bridgeStatus = st
			a.mu.Unlock()
			mygo.RunOnMain(func() {
				a.syncTrayAppearance()
				a.invalidateWindows()
			})
		},
	})
	return a
}

func (a *helperApp) effectiveDevice() (string, string) {
	a.mu.RLock()
	sel := a.selectedDeviceID
	devices := append([]audiocapture.InputDevice(nil), a.devices...)
	a.mu.RUnlock()

	if sel != "" {
		for _, d := range devices {
			if d.ID == sel {
				return d.ID, d.Name
			}
		}
	}
	for _, d := range devices {
		if d.IsDefault {
			return "", d.Name
		}
	}
	if len(devices) > 0 {
		return "", devices[0].Name
	}
	return "", "Default Microphone"
}

func (a *helperApp) prefsPath() string {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil || dir == "" {
		return ""
	}
	return filepath.Join(dir, "preferences.json")
}

func (a *helperApp) loadPrefs() {
	p := a.prefsPath()
	if p == "" {
		return
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var prefs persistedPrefs
	if json.Unmarshal(raw, &prefs) != nil {
		return
	}
	a.mu.Lock()
	switch prefs.ThemeMode {
	case "light":
		a.themeMode = theme.ModeLight
	case "dark":
		a.themeMode = theme.ModeDark
	default:
		a.themeMode = theme.ModeSystem
	}
	a.selectedDeviceID = prefs.SelectedDeviceID
	a.mu.Unlock()
}

func (a *helperApp) savePrefs() {
	p := a.prefsPath()
	if p == "" {
		return
	}
	a.mu.RLock()
	prefs := persistedPrefs{
		ThemeMode:        a.themeMode.String(),
		SelectedDeviceID: a.selectedDeviceID,
	}
	a.mu.RUnlock()
	raw, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	_ = os.WriteFile(p, raw, 0o600)
}

func (a *helperApp) applyThemeMode(mode theme.Mode) {
	a.mu.Lock()
	a.themeMode = mode
	a.mu.Unlock()

	switch mode {
	case theme.ModeLight:
		mygo.Theme.SetSource(mygo.ThemeLight)
	case theme.ModeDark:
		mygo.Theme.SetSource(mygo.ThemeDark)
	default:
		mygo.Theme.SetSource(mygo.ThemeSystem)
	}
	go a.savePrefs()
	a.invalidateWindows()
}

func (a *helperApp) refreshDevices() {
	if a.engine == nil {
		return
	}
	devices, err := a.engine.ListDevices()
	if err != nil {
		return
	}
	a.mu.Lock()
	a.devices = devices
	a.mu.Unlock()
	mygo.RunOnMain(a.invalidateWindows)
}

func (a *helperApp) invalidateWindows() {
	if a.flyout != nil && !a.flyout.IsDestroyed() {
		a.flyout.Invalidate()
	}
	if a.guideWin != nil && !a.guideWin.IsDestroyed() {
		a.guideWin.Invalidate()
	}
}

func (a *helperApp) syncTrayAppearance() {
	if a.tray == nil {
		return
	}
	a.mu.RLock()
	capturing := a.bridgeStatus.Capturing
	needsSetup := a.permSnap.NeedsSetup()
	a.mu.RUnlock()

	if capturing {
		_ = a.tray.SetIcon(a.streamingIcon, false)
		a.tray.SetTitle("Live")
		a.tray.SetToolTip("Mico Helper — Streaming to Mico Live")
		return
	}
	_ = a.tray.SetIcon(a.idleIcon, true)
	a.tray.SetTitle("")
	if needsSetup {
		a.tray.SetToolTip("Mico Helper — Audio permissions needed")
	} else {
		a.tray.SetToolTip("Mico Helper — Ready for Mico Live")
	}
}

func (a *helperApp) toggleFlyout() {
	if a.flyout != nil && !a.flyout.IsDestroyed() {
		a.flyout.Close()
		return
	}
	go a.refreshDevices()
	go a.perms.RefreshPassive()

	a.flyout = mygo.NewFlyout(mygo.FlyoutOptions{
		Tray:       a.tray,
		Placement:  mygo.PlacementBottom,
		Gap:        5,
		Width:      view.FlyoutWidth,
		Height:     380,
		FitContent: true,
		MinWidth:   view.FlyoutWidth,
		MaxWidth:   view.FlyoutWidth,
		Focusable:  true,
		Shadow:     true,
		Popover:    true,
		Content:    ui.View(a.renderFlyout),
	})
	a.flyout.OnClosed(func() {
		a.flyout = nil
	})
}

func (a *helperApp) openPermissionGuide() {
	if a.flyout != nil && !a.flyout.IsDestroyed() {
		a.flyout.Close()
	}
	go a.perms.RefreshPassive()

	if a.guideWin != nil && !a.guideWin.IsDestroyed() {
		a.guideWin.Show()
		a.guideWin.Focus()
		mygo.App.Focus()
		return
	}
	a.guideWin = mygo.NewWindow(mygo.WindowOptions{
		Title:     "Mico Helper — Audio Setup",
		Width:     view.GuideWidth,
		Height:    view.GuideHeight,
		MinWidth:  460,
		MinHeight: 540,
		Content:   ui.View(a.renderGuide),
	})
	a.guideWin.Center()
	a.guideWin.OnClosed(func() {
		a.guideWin = nil
	})
	mygo.App.Focus()
}

func (a *helperApp) renderFlyout(c *ui.Context) {
	a.mu.RLock()
	state := view.FlyoutState{
		ThemeMode:        a.themeMode,
		SystemDark:       a.systemDark,
		Permissions:      a.permSnap,
		Bridge:           a.bridgeStatus,
		Devices:          append([]audiocapture.InputDevice(nil), a.devices...),
		SelectedDeviceID: a.selectedDeviceID,
		Now:              time.Now(),
	}
	a.mu.RUnlock()

	view.RenderFlyout(c, state, view.FlyoutActions{
		OnOpenPermissions: a.openPermissionGuide,
		OnStopStreaming: func() {
			go a.server.StopSession()
		},
		OnSelectDevice: func(id string) {
			a.mu.Lock()
			a.selectedDeviceID = id
			a.mu.Unlock()
			go a.savePrefs()
			a.invalidateWindows()
		},
		OnThemeChange: a.applyThemeMode,
		OnRefresh: func() {
			go func() {
				a.refreshDevices()
				a.perms.RefreshPassive()
			}()
		},
		OnQuit: mygo.App.Quit,
	})
}

func (a *helperApp) renderGuide(c *ui.Context) {
	a.mu.RLock()
	state := view.GuideState{
		ThemeMode:   a.themeMode,
		SystemDark:  a.systemDark,
		Permissions: a.permSnap,
	}
	a.mu.RUnlock()

	view.RenderPermissionGuide(c, state, view.GuideActions{
		OnRequestMic: func() {
			go a.perms.RequestMicrophone(context.Background())
		},
		OnOpenMicSettings: func() {
			go func() { _ = a.perms.OpenMicrophoneSettings() }()
		},
		OnGuideSystemAudio: func() {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
				defer cancel()
				a.perms.GuideSystemAudio(ctx)
			}()
		},
		OnVerifySystemAudio: func() {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
				defer cancel()
				a.perms.VerifySystemAudio(ctx)
			}()
		},
		OnOpenSystemSettings: func() {
			go func() { _ = a.perms.OpenSystemAudioSettings() }()
		},
		OnRefresh: func() {
			go func() {
				a.refreshDevices()
				a.perms.RefreshPassive()
			}()
		},
		OnRelaunch: func() {
			mygo.App.Relaunch()
		},
		OnDone: func() {
			if a.guideWin != nil && !a.guideWin.IsDestroyed() {
				a.guideWin.Close()
			}
		},
	})
}

func (a *helperApp) ready() {
	a.loadPrefs()

	a.mu.Lock()
	a.systemDark = mygo.Theme.IsDark()
	mode := a.themeMode
	a.mu.Unlock()

	switch mode {
	case theme.ModeLight:
		mygo.Theme.SetSource(mygo.ThemeLight)
	case theme.ModeDark:
		mygo.Theme.SetSource(mygo.ThemeDark)
	default:
		mygo.Theme.SetSource(mygo.ThemeSystem)
	}

	mygo.Theme.OnUpdated(func() {
		a.mu.Lock()
		a.systemDark = mygo.Theme.IsDark()
		a.mu.Unlock()
		a.invalidateWindows()
	})

	a.refreshDevices()
	snap := a.perms.RefreshPassive()

	if err := a.server.Start(); err != nil {
		log.Printf("mico-helper bridge failed to listen on %s: %v", a.server.Addr(), err)
	} else {
		log.Printf("mico-helper bridge listening on http://%s", a.server.Addr())
	}

	tray, err := mygo.NewTray(mygo.TrayOptions{
		ID:             "com.nocoo.mico.helper.tray",
		Icon:           a.idleIcon,
		IconIsTemplate: true,
		ToolTip:        "Mico Helper",
	})
	if err != nil {
		log.Fatalf("create tray: %v", err)
	}
	a.tray = tray
	a.syncTrayAppearance()

	menu := mygo.NewMenu([]*mygo.MenuItem{
		{Label: "Open Mico Helper", Click: func(*mygo.MenuItem, *mygo.Window) { a.toggleFlyout() }},
		{Label: "Audio Permissions...", Click: func(*mygo.MenuItem, *mygo.Window) { a.openPermissionGuide() }},
		mygo.Separator(),
		{Role: mygo.RoleQuit},
	})
	a.tray.OnClick(a.toggleFlyout)
	a.tray.OnRightClick(func() {
		if a.flyout != nil && !a.flyout.IsDestroyed() {
			a.flyout.Close()
		}
		a.tray.SetMenu(menu)
		defer a.tray.SetMenu(nil)
		a.tray.PopUpMenu()
	})

	if snap.NeedsSetup() {
		a.openPermissionGuide()
	}

	go a.runBackgroundLoop()
}

func (a *helperApp) runBackgroundLoop() {
	streamTick := time.NewTicker(250 * time.Millisecond)
	refreshTick := time.NewTicker(2 * time.Second)
	defer streamTick.Stop()
	defer refreshTick.Stop()

	for {
		select {
		case <-a.stopBg:
			return
		case <-streamTick.C:
			if a.server.Status().Capturing {
				mygo.RunOnMain(func() {
					if a.flyout != nil && !a.flyout.IsDestroyed() {
						a.flyout.Invalidate()
					}
				})
			}
		case <-refreshTick.C:
			mygo.RunOnMain(func() {
				flyoutOpen := a.flyout != nil && !a.flyout.IsDestroyed()
				guideOpen := a.guideWin != nil && !a.guideWin.IsDestroyed()
				if flyoutOpen || guideOpen {
					go func() {
						a.perms.RefreshPassive()
						if flyoutOpen {
							a.refreshDevices()
						}
					}()
				}
			})
		}
	}
}

func (a *helperApp) shutdown() {
	select {
	case <-a.stopBg:
	default:
		close(a.stopBg)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = a.server.Shutdown(ctx)
	if a.tray != nil {
		a.tray.Destroy()
	}
}

func main() {
	app := newHelperApp()

	mygo.App.SetName("Mico Helper")
	mygo.App.SetVersion(appVersion)
	mygo.App.SetActivationPolicy(mygo.ActivationPolicyAccessory)

	if !mygo.App.RequestSingleInstanceLock() {
		fmt.Fprintln(os.Stderr, "Mico Helper is already running.")
		return
	}
	mygo.App.OnSecondInstance(func(_ []string, _ string) {
		mygo.RunOnMain(func() {
			if app.perms.Snapshot().NeedsSetup() {
				app.openPermissionGuide()
			} else {
				app.toggleFlyout()
			}
		})
	})

	// Menu bar utility: stay alive after flyout or setup window closes.
	mygo.App.OnWindowAllClosed(func() {})
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
		app.shutdown()
	})
	mygo.App.WhenReady(app.ready)

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
