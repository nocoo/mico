# Changelog

## v0.2.0

- Redesign the floating identity, view controls, inspector and grouped tool dock with Lucide icons and hover-only shortcut hints.
- Introduce fixed control, icon and typography tiers, device-local interface preferences, and eight-pixel frame alignment.
- Draw connectors by dragging between nodes; highlight candidate anchors and persist the exact selected attachment.
- Rebind either endpoint by dragging or using keyboard-accessible inspector controls, preserving cancellation and concurrent-write protection.
- Validate persisted anchor indices against node geometry and use exact ellipse proximity for screen-space snapping.
- Add isolated Chrome interaction tests without touching the daily board or development cache.

## v0.1.1

- Serve local development at `https://mico.dev.hexly.ai` with same-origin API and secure WebSocket proxying.
- Assign the 7063/17063/27063/37063 development and isolated-test port series.
- Watch daemon source changes and reconnect live canvases after restarts, retaining polling recovery.
- Fit large boards on first load and with the Fit action or F shortcut.
- Add a distributed-commerce API example with 20 nodes and 27 connectors without clearing existing diagrams.
- Derive the UI version pill and `GET /api/live` version from the root package manifest.
