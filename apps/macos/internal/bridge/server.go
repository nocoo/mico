package bridge

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/nocoo/mico/apps/macos/internal/permissions"
	"github.com/nocoo/mico/apps/macos/modules/audiocapture"
)

const DefaultAddr = "127.0.0.1:47065"

type Status struct {
	Capturing    bool
	AudioLevel   float64
	StartedAt    time.Time
	ClientOrigin string
	DeviceName   string
	LastError    string
}

type Config struct {
	Addr              string
	Version           string
	OriginPolicy      *OriginPolicy
	Engine            audiocapture.Engine
	Permissions       *permissions.Manager
	SelectedDevice    func() (id string, name string)
	OnOpenPermissions func()
	OnStateChange     func(Status)
}

type Server struct {
	addr              string
	version           string
	originPolicy      *OriginPolicy
	engine            audiocapture.Engine
	perms             *permissions.Manager
	selectedDevice    func() (id string, name string)
	onOpenPermissions func()
	onStateChange     func(Status)

	mu            sync.RWMutex
	listener      net.Listener
	httpServer    *http.Server
	status        Status
	sessionCancel context.CancelFunc
	sessionStoppedByUI atomic.Bool
}

type healthPermissions struct {
	Microphone  string `json:"microphone"`
	SystemAudio string `json:"systemAudio"`
}

type healthResponse struct {
	App          string            `json:"app"`
	Version      string            `json:"version"`
	Platform     string            `json:"platform"`
	Ready        bool              `json:"ready"`
	Capturing    bool              `json:"capturing"`
	Permissions  healthPermissions `json:"permissions"`
	ActiveDevice string            `json:"activeDevice"`
	SampleRate   int               `json:"sampleRate"`
	Channels     int               `json:"channels"`
	Encoding     string            `json:"encoding"`
}

type wsClientMessage struct {
	Type string `json:"type"`
}

type wsServerMessage struct {
	Type       string `json:"type"`
	Code       string `json:"code,omitempty"`
	Message    string `json:"message,omitempty"`
	SampleRate int    `json:"sampleRate,omitempty"`
	Channels   int    `json:"channels,omitempty"`
	Encoding   string `json:"encoding,omitempty"`
	Device     string `json:"device,omitempty"`
}

func NewServer(cfg Config) *Server {
	addr := cfg.Addr
	if addr == "" {
		addr = DefaultAddr
	}
	version := cfg.Version
	if version == "" {
		version = "0.1.0"
	}
	policy := cfg.OriginPolicy
	if policy == nil {
		policy = NewOriginPolicy("")
	}
	return &Server{
		addr:              addr,
		version:           version,
		originPolicy:      policy,
		engine:            cfg.Engine,
		perms:             cfg.Permissions,
		selectedDevice:    cfg.SelectedDevice,
		onOpenPermissions: cfg.OnOpenPermissions,
		onStateChange:     cfg.OnStateChange,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /open-permissions", s.handleOpenPermissions)
	mux.HandleFunc("GET /stream", s.handleStream)
	return s.corsMiddleware(mux)
}

func (s *Server) Start() error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}
	srv := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	s.mu.Lock()
	s.listener = ln
	s.httpServer = srv
	s.mu.Unlock()

	go func() {
		_ = srv.Serve(ln)
	}()
	return nil
}

func (s *Server) Addr() string {
	s.mu.RLock()
	ln := s.listener
	s.mu.RUnlock()
	if ln != nil {
		return ln.Addr().String()
	}
	return s.addr
}

func (s *Server) Status() Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

func (s *Server) StopSession() {
	s.mu.RLock()
	cancel := s.sessionCancel
	s.mu.RUnlock()
	if cancel != nil {
		s.sessionStoppedByUI.Store(true)
		cancel()
	}
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.StopSession()
	s.mu.RLock()
	srv := s.httpServer
	s.mu.RUnlock()
	if srv == nil {
		return nil
	}
	return srv.Shutdown(ctx)
}

func (s *Server) notifyState(st Status) {
	if s.onStateChange != nil {
		s.onStateChange(st)
	}
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin")
		w.Header().Add("Vary", "Access-Control-Request-Private-Network")

		origin := r.Header.Get("Origin")
		if origin != "" {
			if !s.originPolicy.Allowed(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
			}
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) resolveDevice() (string, string) {
	if s.selectedDevice == nil {
		return "", "Default Microphone"
	}
	id, name := s.selectedDevice()
	if name == "" {
		name = "Default Microphone"
	}
	return id, name
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	var snap permissions.Snapshot
	if s.perms != nil {
		snap = s.perms.RefreshPassive()
	}
	_, deviceName := s.resolveDevice()
	st := s.Status()

	resp := healthResponse{
		App:       "mico-helper",
		Version:   s.version,
		Platform:  "darwin",
		Ready:     snap.AllGranted(),
		Capturing: st.Capturing,
		Permissions: healthPermissions{
			Microphone:  string(snap.Microphone),
			SystemAudio: string(snap.SystemAudio),
		},
		ActiveDevice: deviceName,
		SampleRate:   audiocapture.SampleRate,
		Channels:     audiocapture.Channels,
		Encoding:     audiocapture.Encoding,
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleOpenPermissions(w http.ResponseWriter, _ *http.Request) {
	if s.onOpenPermissions != nil {
		s.onOpenPermissions()
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(ctx context.Context, conn *websocket.Conn, msg wsServerMessage) error {
	payload, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(writeCtx, websocket.MessageText, payload)
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	// Origin has already been validated by corsMiddleware when present.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	if s.perms != nil {
		snap := s.perms.RefreshPassive()
		if !snap.AllGranted() {
			if s.onOpenPermissions != nil {
				s.onOpenPermissions()
			}
			_ = writeJSON(r.Context(), conn, wsServerMessage{
				Type:    "error",
				Code:    "permissions_required",
				Message: "Grant Microphone and System Audio access in Mico Helper.",
			})
			_ = conn.Close(websocket.StatusPolicyViolation, "permissions_required")
			return
		}
	}

	if s.engine == nil {
		_ = writeJSON(r.Context(), conn, wsServerMessage{
			Type:    "error",
			Code:    "capture_failed",
			Message: "Native audio capture engine is unavailable.",
		})
		_ = conn.Close(websocket.StatusInternalError, "engine_unavailable")
		return
	}

	deviceID, deviceName := s.resolveDevice()
	streamCtx, streamCancel := context.WithCancel(r.Context())

	s.mu.Lock()
	if s.status.Capturing {
		s.mu.Unlock()
		streamCancel()
		_ = writeJSON(r.Context(), conn, wsServerMessage{
			Type:    "error",
			Code:    "busy",
			Message: "Mico Helper is already streaming to another Mico tab.",
		})
		_ = conn.Close(websocket.StatusTryAgainLater, "busy")
		return
	}
	s.sessionStoppedByUI.Store(false)
	s.sessionCancel = streamCancel
	s.status = Status{
		Capturing:    true,
		AudioLevel:   0,
		StartedAt:    time.Now(),
		ClientOrigin: r.Header.Get("Origin"),
		DeviceName:   deviceName,
		LastError:    "",
	}
	startedState := s.status
	s.mu.Unlock()
	s.notifyState(startedState)

	defer func() {
		streamCancel()
		s.mu.Lock()
		s.sessionCancel = nil
		s.status.Capturing = false
		s.status.AudioLevel = 0
		s.status.StartedAt = time.Time{}
		s.status.ClientOrigin = ""
		endedState := s.status
		s.mu.Unlock()
		s.notifyState(endedState)
	}()

	var stopRequested atomic.Bool
	var clientClosed atomic.Bool

	go func() {
		for {
			msgType, data, readErr := conn.Read(r.Context())
			if readErr != nil {
				clientClosed.Store(true)
				streamCancel()
				return
			}
			if msgType == websocket.MessageText {
				var msg wsClientMessage
				if json.Unmarshal(data, &msg) == nil && msg.Type == "stop" {
					stopRequested.Store(true)
					streamCancel()
					return
				}
			}
		}
	}()

	if err := writeJSON(r.Context(), conn, wsServerMessage{
		Type:       "started",
		SampleRate: audiocapture.SampleRate,
		Channels:   audiocapture.Channels,
		Encoding:   audiocapture.Encoding,
		Device:     deviceName,
	}); err != nil {
		return
	}

	var hadError bool
	var errCloseStatus = websocket.StatusInternalError
	var errCloseReason = "capture_failed"
	lastLevelEmit := time.Time{}
	smoothedLevel := 0.0

	for buf, streamErr := range s.engine.Stream(streamCtx, deviceID) {
		if streamErr != nil {
			graceful := stopRequested.Load() || s.sessionStoppedByUI.Load() || clientClosed.Load()
			if graceful && errors.Is(streamErr, context.Canceled) {
				break
			}
			hadError = true
			code := "capture_failed"
			if errors.Is(streamErr, audiocapture.ErrPermissionDenied) {
				code = "permissions_required"
				errCloseStatus = websocket.StatusPolicyViolation
				errCloseReason = "permissions_required"
				if s.perms != nil {
					s.perms.ReportCaptureDenied()
				}
				if s.onOpenPermissions != nil {
					s.onOpenPermissions()
				}
			}
			s.mu.Lock()
			s.status.LastError = streamErr.Error()
			s.mu.Unlock()
			if !clientClosed.Load() {
				_ = writeJSON(r.Context(), conn, wsServerMessage{
					Type:    "error",
					Code:    code,
					Message: streamErr.Error(),
				})
			}
			break
		}

		if buf == nil {
			continue
		}
		pcm := buf.Bytes()
		if len(pcm) == 0 {
			continue
		}

		level := pcmLevel(pcm)
		smoothedLevel = smoothedLevel*0.55 + level*0.45
		now := time.Now()
		if now.Sub(lastLevelEmit) >= 80*time.Millisecond {
			lastLevelEmit = now
			s.mu.Lock()
			s.status.AudioLevel = smoothedLevel
			st := s.status
			s.mu.Unlock()
			s.notifyState(st)
		}

		if clientClosed.Load() {
			break
		}
		writeCtx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		writeErr := conn.Write(writeCtx, websocket.MessageBinary, pcm)
		cancel()
		if writeErr != nil {
			clientClosed.Store(true)
			streamCancel()
			break
		}
	}

	if clientClosed.Load() {
		return
	}
	if hadError {
		_ = conn.Close(errCloseStatus, errCloseReason)
		return
	}

	_ = writeJSON(r.Context(), conn, wsServerMessage{Type: "stopped"})
	_ = conn.Close(websocket.StatusNormalClosure, "stopped")
}

// pcmLevel returns a perceptual 0..1 level from 16-bit little-endian PCM bytes.
func pcmLevel(pcm []byte) float64 {
	n := len(pcm) / 2
	if n == 0 {
		return 0
	}
	var sumSq float64
	for i := 0; i+1 < len(pcm); i += 2 {
		sample := int16(binary.LittleEndian.Uint16(pcm[i : i+2]))
		v := float64(sample) / 32768.0
		sumSq += v * v
	}
	rms := math.Sqrt(sumSq / float64(n))
	// Boost quiet speech slightly on a log-like curve so live meters feel responsive.
	level := math.Min(1.0, math.Pow(rms*3.2, 0.72))
	if level < 0.01 {
		return 0
	}
	return level
}
