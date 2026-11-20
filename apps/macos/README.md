# Mico Helper (macOS)

Native macOS menu bar audio capture helper for Mico Live, built with [MyGo](https://github.com/egoist/mygo) (Go + native Swift `ScreenCaptureKit` & `CoreAudio`).

## What it does

- Lives quietly in the macOS menu bar (`LSUIElement: true`) with Light, Dark, and System Auto themes matching Mico.
- Captures both your **microphone** and **system meeting audio** simultaneously via macOS 15+ `ScreenCaptureKit` (`SCStream` `.audio` + `.microphone`) and mixes them into `16 kHz`, mono, `Int16LE` PCM frames.
- Serves a loopback-only HTTP + WebSocket bridge on `http://127.0.0.1:47065` (`/health`, `/open-permissions`, `/stream`) with strict Origin validation (`localhost`, `127.0.0.1`, `::1`, `https://*.azurecontainerapps.io`, plus optional `MICO_HELPER_ALLOWED_ORIGINS`).
- Provides a guided **Audio Setup** window powered by `permissionflow.Guide` (opens macOS System Settings with a floating drag-in panel) plus direct `ScreenCaptureKit` verification and one-click app reopen for stale macOS TCC states.

## Requirements

- macOS 15.0+ (Apple Silicon or Intel)
- Go 1.26+ and Xcode Command Line Tools (`swift`)

## Commands

From the repository root:

```sh
pnpm macos:test   # Run Go unit tests (bridge, permissions, theme, native UI views)
pnpm macos:dev    # Launch Mico Helper in development mode
pnpm macos:build  # Build Mico Helper.app and .dmg under apps/macos/build/
```

Or inside `apps/macos/`:

```sh
go test -v ./...
go tool mygo native check ./modules/audiocapture
go tool mygo build
```

## Environment Variables

- `MICO_HELPER_PORT`: Override the loopback port (default `47065`).
- `MICO_HELPER_ALLOWED_ORIGINS`: Comma-separated list of additional allowed browser origins (supports exact origins like `https://mico.example.com` or HTTPS wildcards like `https://*.example.com`).

## Notes on macOS Permissions

- Running via `go run` or `mygo dev` attributes permissions to your terminal app. For true standalone permissions attributed to `com.nocoo.mico.helper`, build and launch `apps/macos/build/darwin-arm64/Mico Helper.app`.
- Ad-hoc signed local builds may require re-granting Screen & System Audio Recording after rebuilding the binary. Signing with a stable Developer ID identity preserves TCC grants across updates.
