package permissions

import (
	"context"
	"testing"

	"github.com/egoist/mygo/plugins/permissionflow"
	"github.com/nocoo/mico/apps/macos/modules/audiocapture"
)

type fakeBackend struct {
	micCheck     permissionflow.Status
	sysCheck     permissionflow.Status
	micReq       permissionflow.Status
	probeResult  audiocapture.ProbeResult
	probeErr     error
	opened       []permissionflow.Permission
	guided       []permissionflow.Permission
	probeCalls   int
}

func (f *fakeBackend) Check(p permissionflow.Permission) (permissionflow.Status, error) {
	if p == permissionflow.Microphone {
		return f.micCheck, nil
	}
	return f.sysCheck, nil
}

func (f *fakeBackend) Request(_ context.Context, p permissionflow.Permission) (permissionflow.Status, error) {
	if p == permissionflow.Microphone {
		f.micCheck = f.micReq
		return f.micReq, nil
	}
	return f.sysCheck, nil
}

func (f *fakeBackend) Guide(_ context.Context, p permissionflow.Permission) (permissionflow.Status, error) {
	f.guided = append(f.guided, p)
	return f.sysCheck, nil
}

func (f *fakeBackend) OpenSettings(p permissionflow.Permission) error {
	f.opened = append(f.opened, p)
	return nil
}

func (f *fakeBackend) ProbeScreenCapture(_ context.Context) (audiocapture.ProbeResult, error) {
	f.probeCalls++
	return f.probeResult, f.probeErr
}

func TestRefreshPassivePreservesUnknownSystemAudioUntilVerified(t *testing.T) {
	fb := &fakeBackend{
		micCheck: permissionflow.NotDetermined,
		sysCheck: permissionflow.Denied,
	}
	m := NewManager(fb, nil)
	snap := m.RefreshPassive()
	if snap.Microphone != StatusUnknown {
		t.Fatalf("expected unknown mic, got %s", snap.Microphone)
	}
	if snap.SystemAudio != StatusUnknown {
		t.Fatalf("expected unknown system audio before explicit check, got %s", snap.SystemAudio)
	}
	if snap.MissingCount() != 2 || !snap.NeedsSetup() {
		t.Fatalf("expected 2 missing permissions, got %+v", snap)
	}
}

func TestVerifySystemAudioOverridesStalePreflight(t *testing.T) {
	fb := &fakeBackend{
		micCheck:    permissionflow.Granted,
		sysCheck:    permissionflow.Denied, // stale CGPreflight
		probeResult: audiocapture.ProbeResult{Status: audiocapture.ProbeGranted},
	}
	m := NewManager(fb, nil)
	m.RefreshPassive()
	snap := m.VerifySystemAudio(context.Background())
	if !snap.AllGranted() {
		t.Fatalf("expected all granted after SCK probe, got %+v", snap)
	}
	// Subsequent passive refresh must keep verified ScreenCaptureKit grant.
	snap = m.RefreshPassive()
	if snap.SystemAudio != StatusGranted {
		t.Fatalf("expected verified grant to persist across passive refresh, got %+v", snap)
	}
}

func TestCaptureDenialInvalidatesCachedGrant(t *testing.T) {
	fb := &fakeBackend{
		micCheck:    permissionflow.Granted,
		sysCheck:    permissionflow.Granted,
		probeResult: audiocapture.ProbeResult{Status: audiocapture.ProbeGranted},
	}
	m := NewManager(fb, nil)
	m.RefreshPassive()
	m.VerifySystemAudio(context.Background())

	snap := m.ReportCaptureDenied()
	if snap.SystemAudio != StatusDenied || !snap.NeedsReopenHint {
		t.Fatalf("expected denied + reopen hint, got %+v", snap)
	}
}

func TestRequestMicrophoneWhenDeniedOpensSettings(t *testing.T) {
	fb := &fakeBackend{
		micCheck: permissionflow.Denied,
		sysCheck: permissionflow.Granted,
	}
	m := NewManager(fb, nil)
	m.RefreshPassive()
	m.RequestMicrophone(context.Background())
	if len(fb.opened) != 1 || fb.opened[0] != permissionflow.Microphone {
		t.Fatalf("expected microphone settings to open, got %v", fb.opened)
	}
}

func TestGuideSystemAudioRunsGuideAndVerifies(t *testing.T) {
	fb := &fakeBackend{
		micCheck:    permissionflow.Granted,
		sysCheck:    permissionflow.Denied,
		probeResult: audiocapture.ProbeResult{Status: audiocapture.ProbeGranted},
	}
	m := NewManager(fb, nil)
	snap := m.GuideSystemAudio(context.Background())
	if len(fb.guided) != 1 || fb.guided[0] != permissionflow.ScreenRecording {
		t.Fatalf("expected guided screen recording, got %v", fb.guided)
	}
	if fb.probeCalls != 1 || snap.SystemAudio != StatusGranted {
		t.Fatalf("expected post-guide verification to grant, got calls=%d snap=%+v", fb.probeCalls, snap)
	}
}
