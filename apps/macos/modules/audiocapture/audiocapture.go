package audiocapture

import (
	"context"
	"iter"

	"github.com/egoist/mygo/native"
)

const (
	SampleRate = 16000
	Channels   = 1
	Encoding   = "pcm_s16le"
	// FrameSamples is 100ms of 16kHz mono audio (1600 Int16 samples = 3200 bytes).
	FrameSamples = 1600
	FrameBytes   = FrameSamples * 2
)

type InputDevice struct {
	ID        string
	Name      string
	IsDefault bool
}

type ProbeStatus string

const (
	ProbeGranted     ProbeStatus = "granted"
	ProbeDenied      ProbeStatus = "denied"
	ProbeUnavailable ProbeStatus = "unavailable"
)

type ProbeResult struct {
	Status ProbeStatus
	Detail string
}

var (
	ErrPermissionDenied = native.NewError("permission_denied")
	ErrNoDisplay        = native.NewError("no_display")
	ErrNoMicrophone     = native.NewError("no_microphone")
)

// Engine captures macOS system audio and microphone input via ScreenCaptureKit
// and CoreAudio, outputting 16kHz mono signed 16-bit little-endian PCM frames.
//
//mygo:native
type Engine interface {
	ListDevices() ([]InputDevice, error)
	ProbeScreenCapture(ctx context.Context) (ProbeResult, error)
	Stream(ctx context.Context, deviceID string) iter.Seq2[*native.Buffer, error]
}
