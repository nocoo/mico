# Changelog

## Unreleased

## v0.8.0

- Add explicit Managed Identity authentication for Foundry Chat and MAI streaming, with SDK token caching/refresh and no API-key or developer-credential fallback.
- Keep managed settings read-only and isolated from saved keys; identify the authentication mode in Settings.
- Add independent MOSS availability across the runtime, API, WebSocket proxy and UI. Managed Azure profiles disable MOSS and select MAI for Live.
- Protect asynchronous provider authentication with cancellation checks, bounded early-audio queues, frame/backpressure limits and redirect rejection.
- Extend the Azure adapter with environment-driven managed model settings and attached-identity validation, while retaining optional user login and ephemeral preview storage.
- Add an explicitly authorized, synthetic-audio verification command that exercises real Chat tools, MAI transcription and lecture handling in an isolated loopback daemon/database.
- Expand managed-provider unit, HTTP/WebSocket and browser contracts; preserve local API-key behavior without adding alternate environment-variable aliases.

## v0.7.0

### Hosted preview

- Add a provider-neutral container runtime with independently optional Entra SPA login, AI availability and a temporary-data notice.
- Add the Azure Container Apps preview adapter and `mico-deploy` project skill: external environment configuration, managed-identity image pull, immutable image digests and repeatable acceptance checks.
- Protect authenticated HTTP and WebSocket entrypoints with canonical request paths, same-origin writes, an allowed-user list, revocable sessions and private response caching policy.
- Move deployment status, AI availability, account details and sign-out into a glass Debug panel beside Canvases. Optional Microsoft profile photos use silent delegated access and fall back without blocking the workspace.
- Keep the Azure preview at one replica with AI disabled and ephemeral SQLite. Container replacement can erase canvas data and sessions; durable cloud storage and other cloud adapters remain separate work.

### Canvas and assistant

- Add named canvas management across the browser, HTTP API and CLI, with synchronized active-canvas state and lightweight previews.
- Refresh the application frame and canvas elements with the glass/jelly design, responsive panels, inline editing, reference-based visual checks and Linux font fixes.
- Add minimap navigation and per-canvas undo/redo for manual edits, preserving concurrent external operations through revision checks.
- Add editable note labels, shared HTML card design fragments and persistent action cards with stable item IDs, completion state and undo support.
- Add streaming canvas-aware Chat, recorded Audio playback/transcription, MAI microphone sessions and MOSS Live tools. Local provider configuration remains available; cloud AI can be disabled independently.
- Generate HTML summaries and action cards after recorded or MAI sessions, with retry recovery pinned to the original canvas. MOSS exposes the tools but does not automatically summarize on stop.
- Preserve sandboxed inline HTML/scripts while blocking external iframe resources, and isolate AI tools and generated images to their intended canvases.

### Delivery and verification

- Add local Docker packaging for the production UI, API and voice proxies, with isolated data volumes and real-browser container checks.
- Expand unit, HTTP/WebSocket, CLI, browser, visual and security regression coverage; discover Node tests automatically and include hosted identity controls in the browser gate.
- Add staged-index and exact-pushed-revision Git gates, zero-warning lint, dependency/secret scans and the aggregate CI quality gate. Push checks preserve the shared dependency installation.

## v0.6.5

- Move the selection editor to a fixed right-side inspector rail on desktop, only falling back to a bottom sheet on narrow screens.
- Normalize panel rhythm on a 4px grid: 12px padding, 8px field gaps, 4px label gaps and 32px controls.
- Hide the inspector while a drawing tool is active so it never blocks canvas creation.

## v0.6.4

- Move the selection editor into an independent floating Radix Themes card, fully decoupled from the bottom tool dock.
- Rebuild property rows with consistent labels, inputs, selects and buttons; no more squeezed columns or overlapping controls.

## v0.6.3

- Give text shapes and rich widgets real hit targets so nested cards inside frames can be selected and dragged.
- Double-click text, notes, frames and rich widgets to edit their text directly on the canvas; Escape cancels and blur or Enter commits.

## v0.6.2

- Unify frame and rich-widget headers into one floating pill above the card: colored kind icon, title and grip handle with an 8px gap.

## v0.6.1

- Adopt Radix Themes for all frame controls: buttons, tooltips, selects and text inputs now share the library's motion, focus and elevation.
- Give frames and rich widgets a standard card header with kind icon, grip handle and title.
- Keep frame contents individually editable and detach an item when it is dragged outside its frame.

## v0.6.0

- Block browser-level page zoom while keeping canvas zoom independent.
- Marquee-select multiple objects on the canvas and delete them atomically.
- Add named frames that wrap a selection with padding, move their members together and release them on delete.
- Add pastel sticky notes with multi-line text and a five-colour palette.
- Render text without a box and expose handwriting, serif, sans and mono families with size and weight tiers.
- Add isolated rich widgets: checklist, kanban, table and timeline cards with editable titles and items.
- Prevent other objects from entering a widget card while keeping overlays possible.

## v0.5.0

- Add persisted `path` shapes with brush style, stroke width and validated relative points.
- Draw freehand strokes with pencil, marker and tapered brush styles at 2/4/8px widths.
- Expose brush style and width for AI agents through the existing batch API, with an example sketch.
- Tighten dock property padding and use 32px inputs inside the single-row toolbar.
- Remove the logo background so the mark sits directly on the canvas.

## v0.4.1

- Sample the Miro reference for a 242 base gray and 238 grid lines; soften the blueprint palette toward those near-neutral values.
- Size the bottom dock to its content instead of a reserved width, and add four-pixel gaps between every button.
- Put selected-object properties in the same single-row dock with fixed 96px label and 40px color/close columns.
- Align control geometry, dividers, selection insets and popovers to a four-pixel spacing system.
- Verify button gaps and dock resizing in the isolated Chrome suite.

## v0.4.0

- Lighten the blueprint grid to a solid 64px line with four dashed cells between solid lines.
- Simplify the identity panel to the logo and a breathing green connection light; remove the version, board name and text badge.
- Move selected-object properties into the bottom dock and remove the interface settings controls.
- Snap dragged objects to the 16px grid and to nearby object edges/centers, showing alignment guide lines.
- Reject invalid grid coordinates explicitly and keep snapping deterministic across zoom levels.

## v0.3.0

- Add a world-aligned blueprint grid with solid 64px cells, dashed 32px subdivisions and 8px fine lines, softening dense details at low zoom.
- Merge zoom, reset, Fit and interface settings into the drawing dock and remove the separate top-right control surface.
- Keep the identity panel and dock fixed in screen space independently of canvas pan and zoom.
- Wrap the unified dock on narrow screens and place settings above it without clipping controls or overlays.
- Verify unchanged frame geometry from 5% to 300% zoom and on-screen controls across every interface size tier.

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
