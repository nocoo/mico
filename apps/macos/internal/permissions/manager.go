package permissions

import (
	"context"
	"errors"
	"sync"

	"github.com/egoist/mygo/plugins/permissionflow"
	"github.com/nocoo/mico/apps/macos/modules/audiocapture"
)

type Status string

const (
	StatusUnknown Status = "unknown"
	StatusGranted Status = "granted"
	StatusDenied  Status = "denied"
)

type Snapshot struct {
	Microphone       Status
	SystemAudio      Status
	RequestingMic    bool
	RequestingSystem bool
	Guiding          bool
	SystemIssue      string
	NeedsReopenHint  bool
}

func (s Snapshot) AllGranted() bool {
	return s.Microphone == StatusGranted && s.SystemAudio == StatusGranted
}

func (s Snapshot) NeedsSetup() bool {
	return !s.AllGranted()
}

func (s Snapshot) MissingCount() int {
	n := 0
	if s.Microphone != StatusGranted {
		n++
	}
	if s.SystemAudio != StatusGranted {
		n++
	}
	return n
}

type Backend interface {
	Check(p permissionflow.Permission) (permissionflow.Status, error)
	Request(ctx context.Context, p permissionflow.Permission) (permissionflow.Status, error)
	Guide(ctx context.Context, p permissionflow.Permission) (permissionflow.Status, error)
	OpenSettings(p permissionflow.Permission) error
	ProbeScreenCapture(ctx context.Context) (audiocapture.ProbeResult, error)
}

type SystemBackend struct {
	Engine audiocapture.Engine
}

func (b SystemBackend) Check(p permissionflow.Permission) (permissionflow.Status, error) {
	return permissionflow.Check(p)
}

func (b SystemBackend) Request(ctx context.Context, p permissionflow.Permission) (permissionflow.Status, error) {
	return permissionflow.Request(ctx, p)
}

func (b SystemBackend) Guide(ctx context.Context, p permissionflow.Permission) (permissionflow.Status, error) {
	return permissionflow.Guide(ctx, p, permissionflow.GuideOptions{})
}

func (b SystemBackend) OpenSettings(p permissionflow.Permission) error {
	return permissionflow.OpenSettings(p)
}

func (b SystemBackend) ProbeScreenCapture(ctx context.Context) (audiocapture.ProbeResult, error) {
	if b.Engine == nil {
		return audiocapture.ProbeResult{Status: audiocapture.ProbeUnavailable, Detail: "Audio engine unavailable"}, errors.ErrUnsupported
	}
	return b.Engine.ProbeScreenCapture(ctx)
}

type Manager struct {
	mu          sync.RWMutex
	backend     Backend
	state       Snapshot
	verifiedSys *Status
	onChange    func(Snapshot)
}

func NewManager(backend Backend, onChange func(Snapshot)) *Manager {
	return &Manager{
		backend: backend,
		state: Snapshot{
			Microphone:  StatusUnknown,
			SystemAudio: StatusUnknown,
		},
		onChange: onChange,
	}
}

func (m *Manager) Snapshot() Snapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state
}

func (m *Manager) notify(snap Snapshot) {
	if m.onChange != nil {
		m.onChange(snap)
	}
}

func mapFlowStatus(st permissionflow.Status, err error) Status {
	if err != nil {
		return StatusUnknown
	}
	switch st {
	case permissionflow.Granted:
		return StatusGranted
	case permissionflow.Denied:
		return StatusDenied
	default:
		return StatusUnknown
	}
}

// RefreshPassive checks permissions without triggering macOS interactive prompts.
func (m *Manager) RefreshPassive() Snapshot {
	micSt, micErr := m.backend.Check(permissionflow.Microphone)
	sysSt, sysErr := m.backend.Check(permissionflow.ScreenRecording)

	m.mu.Lock()
	prev := m.state
	m.state.Microphone = mapFlowStatus(micSt, micErr)
	if m.verifiedSys != nil {
		m.state.SystemAudio = *m.verifiedSys
	} else {
		mapped := mapFlowStatus(sysSt, sysErr)
		// CGPreflightScreenCaptureAccess returns Denied/false even before first prompt;
		// preserve Unknown until user checks or denies explicitly.
		if mapped == StatusGranted {
			m.state.SystemAudio = StatusGranted
			m.state.NeedsReopenHint = false
		} else if m.state.SystemAudio != StatusUnknown {
			m.state.SystemAudio = StatusDenied
		}
	}
	snap := m.state
	m.mu.Unlock()
	if snap != prev {
		m.notify(snap)
	}
	return snap
}

func (m *Manager) RequestMicrophone(ctx context.Context) Snapshot {
	m.mu.Lock()
	if m.state.RequestingMic {
		snap := m.state
		m.mu.Unlock()
		return snap
	}
	alreadyDenied := m.state.Microphone == StatusDenied
	m.state.RequestingMic = true
	snap := m.state
	m.mu.Unlock()
	m.notify(snap)

	if alreadyDenied {
		_ = m.backend.OpenSettings(permissionflow.Microphone)
	} else {
		st, err := m.backend.Request(ctx, permissionflow.Microphone)
		m.mu.Lock()
		m.state.Microphone = mapFlowStatus(st, err)
		m.mu.Unlock()
	}

	m.mu.Lock()
	m.state.RequestingMic = false
	snap = m.state
	m.mu.Unlock()
	m.notify(snap)
	return snap
}

func (m *Manager) OpenMicrophoneSettings() error {
	return m.backend.OpenSettings(permissionflow.Microphone)
}

func (m *Manager) OpenSystemAudioSettings() error {
	m.mu.Lock()
	m.state.NeedsReopenHint = true
	snap := m.state
	m.mu.Unlock()
	m.notify(snap)
	return m.backend.OpenSettings(permissionflow.ScreenRecording)
}

// VerifySystemAudio uses ScreenCaptureKit directly (bypassing stale CG preflight cache).
func (m *Manager) VerifySystemAudio(ctx context.Context) Snapshot {
	m.mu.Lock()
	if m.state.RequestingSystem {
		snap := m.state
		m.mu.Unlock()
		return snap
	}
	m.state.RequestingSystem = true
	m.state.SystemIssue = ""
	snap := m.state
	m.mu.Unlock()
	m.notify(snap)

	res, err := m.backend.ProbeScreenCapture(ctx)
	m.mu.Lock()
	m.state.RequestingSystem = false
	if err != nil {
		if errors.Is(err, errors.ErrUnsupported) {
			st, chkErr := m.backend.Request(ctx, permissionflow.ScreenRecording)
			mapped := mapFlowStatus(st, chkErr)
			m.state.SystemAudio = mapped
			if mapped != StatusGranted {
				m.state.NeedsReopenHint = true
			}
		} else {
			m.state.SystemIssue = err.Error()
			m.state.NeedsReopenHint = true
		}
	} else {
		switch res.Status {
		case audiocapture.ProbeGranted:
			g := StatusGranted
			m.verifiedSys = &g
			m.state.SystemAudio = StatusGranted
			m.state.SystemIssue = ""
			m.state.NeedsReopenHint = false
		case audiocapture.ProbeDenied:
			d := StatusDenied
			m.verifiedSys = &d
			m.state.SystemAudio = StatusDenied
			m.state.SystemIssue = ""
			m.state.NeedsReopenHint = true
		default:
			m.state.SystemIssue = res.Detail
			m.state.NeedsReopenHint = true
		}
	}
	snap = m.state
	m.mu.Unlock()
	m.notify(snap)
	return snap
}

// GuideSystemAudio opens macOS System Settings with MyGo's floating drag-in guide panel.
func (m *Manager) GuideSystemAudio(ctx context.Context) Snapshot {
	m.mu.Lock()
	if m.state.Guiding {
		snap := m.state
		m.mu.Unlock()
		return snap
	}
	m.state.Guiding = true
	m.state.NeedsReopenHint = true
	snap := m.state
	m.mu.Unlock()
	m.notify(snap)

	_, _ = m.backend.Guide(ctx, permissionflow.ScreenRecording)

	m.mu.Lock()
	m.state.Guiding = false
	m.mu.Unlock()

	return m.VerifySystemAudio(ctx)
}

func (m *Manager) GuideMicrophone(ctx context.Context) Snapshot {
	m.mu.Lock()
	if m.state.Guiding {
		snap := m.state
		m.mu.Unlock()
		return snap
	}
	m.state.Guiding = true
	snap := m.state
	m.mu.Unlock()
	m.notify(snap)

	_, _ = m.backend.Guide(ctx, permissionflow.Microphone)

	m.mu.Lock()
	m.state.Guiding = false
	m.mu.Unlock()

	return m.RefreshPassive()
}

func (m *Manager) ReportCaptureDenied() Snapshot {
	m.mu.Lock()
	d := StatusDenied
	m.verifiedSys = &d
	m.state.SystemAudio = StatusDenied
	m.state.NeedsReopenHint = true
	snap := m.state
	m.mu.Unlock()
	m.notify(snap)
	return snap
}
