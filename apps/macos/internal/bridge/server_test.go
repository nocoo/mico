package bridge

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"iter"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/egoist/mygo/native"
	"github.com/egoist/mygo/plugins/permissionflow"
	"github.com/nocoo/mico/apps/macos/internal/permissions"
	"github.com/nocoo/mico/apps/macos/modules/audiocapture"
)

type fakePermBackend struct {
	mic permissionflow.Status
	sys permissionflow.Status
}

func (f *fakePermBackend) Check(p permissionflow.Permission) (permissionflow.Status, error) {
	if p == permissionflow.Microphone {
		return f.mic, nil
	}
	return f.sys, nil
}
func (f *fakePermBackend) Request(_ context.Context, p permissionflow.Permission) (permissionflow.Status, error) {
	return f.Check(p)
}
func (f *fakePermBackend) Guide(_ context.Context, p permissionflow.Permission) (permissionflow.Status, error) {
	return f.Check(p)
}
func (f *fakePermBackend) OpenSettings(_ permissionflow.Permission) error { return nil }
func (f *fakePermBackend) ProbeScreenCapture(_ context.Context) (audiocapture.ProbeResult, error) {
	if f.sys == permissionflow.Granted {
		return audiocapture.ProbeResult{Status: audiocapture.ProbeGranted}, nil
	}
	return audiocapture.ProbeResult{Status: audiocapture.ProbeDenied}, nil
}

type fakeEngine struct {
	streamFn func(ctx context.Context, deviceID string) iter.Seq2[*native.Buffer, error]
}

func (f *fakeEngine) ListDevices() ([]audiocapture.InputDevice, error) { return nil, nil }
func (f *fakeEngine) ProbeScreenCapture(_ context.Context) (audiocapture.ProbeResult, error) {
	return audiocapture.ProbeResult{Status: audiocapture.ProbeGranted}, nil
}
func (f *fakeEngine) Stream(ctx context.Context, deviceID string) iter.Seq2[*native.Buffer, error] {
	return f.streamFn(ctx, deviceID)
}

func makePCMBuffer(sample int16, count int) *native.Buffer {
	buf := native.NewBuffer(count * 2)
	b := buf.Bytes()
	for i := 0; i < count; i++ {
		binary.LittleEndian.PutUint16(b[i*2:i*2+2], uint16(sample))
	}
	return buf
}

func TestOriginPolicy(t *testing.T) {
	p := NewOriginPolicy("https://mico.example.com, https://*.internal.test")
	allowed := []string{
		"http://localhost:7063",
		"http://127.0.0.1:27063",
		"http://[::1]:7063",
		"https://mico-app.wonderfulcoast-24f10e04.westus2.azurecontainerapps.io",
		"https://mico.example.com",
		"https://app.internal.test",
	}
	for _, o := range allowed {
		if !p.Allowed(o) {
			t.Errorf("expected origin %q to be allowed", o)
		}
	}

	denied := []string{
		"",
		"http://mico-app.azurecontainerapps.io",
		"https://azurecontainerapps.io",
		"https://evil.example.com",
		"https://mico.example.com/path",
		"file:///Users/test",
	}
	for _, o := range denied {
		if p.Allowed(o) {
			t.Errorf("expected origin %q to be denied", o)
		}
	}
}

func TestCORSAndPrivateNetworkPreflight(t *testing.T) {
	perms := permissions.NewManager(&fakePermBackend{mic: permissionflow.Granted, sys: permissionflow.Granted}, nil)
	srv := NewServer(Config{Permissions: perms})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	req, _ := http.NewRequest(http.MethodOptions, ts.URL+"/health", nil)
	req.Header.Set("Origin", "https://mico-app.westus2.azurecontainerapps.io")
	req.Header.Set("Access-Control-Request-Private-Network", "true")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("preflight failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Private-Network"); got != "true" {
		t.Fatalf("expected Access-Control-Allow-Private-Network=true, got %q", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "https://mico-app.westus2.azurecontainerapps.io" {
		t.Fatalf("unexpected ACAO: %q", got)
	}

	badReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/health", nil)
	badReq.Header.Set("Origin", "https://evil.example")
	badResp, err := http.DefaultClient.Do(badReq)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	badResp.Body.Close()
	if badResp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for disallowed origin, got %d", badResp.StatusCode)
	}
}

func TestHealthAndOpenPermissions(t *testing.T) {
	var opened atomic.Int32
	perms := permissions.NewManager(&fakePermBackend{mic: permissionflow.Granted, sys: permissionflow.Denied}, nil)
	srv := NewServer(Config{
		Version: "0.2.0",
		Permissions: perms,
		SelectedDevice: func() (string, string) {
			return "mic-1", "Studio Mic"
		},
		OnOpenPermissions: func() {
			opened.Add(1)
		},
	})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/health", nil)
	req.Header.Set("Origin", "http://localhost:7063")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()
	var body healthResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode health: %v", err)
	}
	if body.App != "mico-helper" || body.Version != "0.2.0" || body.Ready {
		t.Fatalf("unexpected health body: %+v", body)
	}
	if body.ActiveDevice != "Studio Mic" || body.SampleRate != 16000 {
		t.Fatalf("unexpected device/format: %+v", body)
	}

	postReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/open-permissions", nil)
	postReq.Header.Set("Origin", "http://localhost:7063")
	postResp, err := http.DefaultClient.Do(postReq)
	if err != nil {
		t.Fatalf("POST /open-permissions: %v", err)
	}
	postResp.Body.Close()
	if postResp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", postResp.StatusCode)
	}
	if opened.Load() != 1 {
		t.Fatalf("expected OnOpenPermissions to be called once, got %d", opened.Load())
	}
}

func TestStreamLifecycleFlushAndBusy(t *testing.T) {
	perms := permissions.NewManager(&fakePermBackend{mic: permissionflow.Granted, sys: permissionflow.Granted}, nil)
	streamStarted := make(chan struct{})
	eng := &fakeEngine{
		streamFn: func(ctx context.Context, _ string) iter.Seq2[*native.Buffer, error] {
			return func(yield func(*native.Buffer, error) bool) {
				close(streamStarted)
				if !yield(makePCMBuffer(1200, 1600), nil) {
					return
				}
				<-ctx.Done()
				// Flush a final tail chunk after stop cancellation.
				_ = yield(makePCMBuffer(600, 400), nil)
			}
		},
	}

	srv := NewServer(Config{
		Permissions: perms,
		Engine:      eng,
		SelectedDevice: func() (string, string) {
			return "mic-1", "MacBook Pro Microphone"
		},
	})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/stream"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	hdr := http.Header{"Origin": []string{"http://localhost:7063"}}
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	defer conn.CloseNow()

	// 1. Expect started message
	typ, data, err := conn.Read(ctx)
	if err != nil || typ != websocket.MessageText {
		t.Fatalf("expected started text msg, got typ=%v err=%v", typ, err)
	}
	var started wsServerMessage
	if err := json.Unmarshal(data, &started); err != nil || started.Type != "started" || started.SampleRate != 16000 {
		t.Fatalf("unexpected started message: %s", string(data))
	}

	// 2. Expect first binary PCM frame
	typ, pcm1, err := conn.Read(ctx)
	if err != nil || typ != websocket.MessageBinary || len(pcm1) != 3200 {
		t.Fatalf("expected 3200-byte binary frame, got typ=%v len=%d err=%v", typ, len(pcm1), err)
	}

	<-streamStarted

	// 3. Second client while active should get busy error
	conn2, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial second ws: %v", err)
	}
	typ2, data2, err := conn2.Read(ctx)
	if err != nil || typ2 != websocket.MessageText {
		t.Fatalf("expected busy error frame, got typ=%v err=%v", typ2, err)
	}
	var busy wsServerMessage
	if err := json.Unmarshal(data2, &busy); err != nil || busy.Code != "busy" {
		t.Fatalf("expected busy error, got %s", string(data2))
	}
	conn2.CloseNow()

	// 4. Send graceful stop from client 1 -> expect tail PCM + stopped
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"stop"}`)); err != nil {
		t.Fatalf("write stop: %v", err)
	}
	typ, pcmTail, err := conn.Read(ctx)
	if err != nil || typ != websocket.MessageBinary || len(pcmTail) != 800 {
		t.Fatalf("expected 800-byte flushed tail, got typ=%v len=%d err=%v", typ, len(pcmTail), err)
	}
	typ, stoppedData, err := conn.Read(ctx)
	if err != nil || typ != websocket.MessageText {
		t.Fatalf("expected stopped text msg, got typ=%v err=%v", typ, err)
	}
	var stopped wsServerMessage
	if err := json.Unmarshal(stoppedData, &stopped); err != nil || stopped.Type != "stopped" {
		t.Fatalf("expected stopped message, got %s", string(stoppedData))
	}
}

func TestStreamPermissionsRequiredAndMenuBarStop(t *testing.T) {
	var opened atomic.Int32
	fb := &fakePermBackend{mic: permissionflow.Granted, sys: permissionflow.Denied}
	perms := permissions.NewManager(fb, nil)

	eng := &fakeEngine{
		streamFn: func(ctx context.Context, _ string) iter.Seq2[*native.Buffer, error] {
			return func(yield func(*native.Buffer, error) bool) {
				if !yield(makePCMBuffer(900, 1600), nil) {
					return
				}
				<-ctx.Done()
			}
		},
	}

	srv := NewServer(Config{
		Permissions:       perms,
		Engine:            eng,
		OnOpenPermissions: func() { opened.Add(1) },
	})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/stream"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	hdr := http.Header{"Origin": []string{"http://localhost:7063"}}

	// Missing permission -> immediate permissions_required error + opens guide
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	_, msgBytes, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read err msg: %v", err)
	}
	var errMsg wsServerMessage
	if err := json.Unmarshal(msgBytes, &errMsg); err != nil || errMsg.Code != "permissions_required" {
		t.Fatalf("expected permissions_required, got %s", string(msgBytes))
	}
	conn.CloseNow()
	if opened.Load() != 1 {
		t.Fatalf("expected permission guide to open once, got %d", opened.Load())
	}

	// Grant system permission and test StopSession() from menu bar
	fb.sys = permissionflow.Granted
	conn2, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial ws2: %v", err)
	}
	defer conn2.CloseNow()
	_, _, _ = conn2.Read(ctx) // started
	_, _, _ = conn2.Read(ctx) // first pcm frame

	srv.StopSession()

	typ, stoppedBytes, err := conn2.Read(ctx)
	if err != nil || typ != websocket.MessageText {
		t.Fatalf("expected stopped frame after StopSession, got typ=%v err=%v", typ, err)
	}
	var stopped wsServerMessage
	if err := json.Unmarshal(stoppedBytes, &stopped); err != nil || stopped.Type != "stopped" {
		t.Fatalf("expected stopped, got %s", string(stoppedBytes))
	}
}
