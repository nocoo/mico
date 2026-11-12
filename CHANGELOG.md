# Changelog

## Unreleased

- Add a top-right AI button and assistant panel with Chat and Audio tabs.
- Connect Chat to the local Magpie gateway through the Vercel AI SDK with streaming responses, a stepwise canvas-agent prompt and a mock model for deterministic tests.
- Give the assistant canvas tools for text, notes, boxes, lines, connectors, frames, strokes, HTML cards, updates and deletes; every call writes and broadcasts immediately.
- Attach the current marquee selection to each AI request as primary context, add quick lesson prompts and a `?ai=` URL trigger for automation.
- Keep the Audio tab as a recording microphone interface placeholder.
- Add a Lesson tab that plays ten recorded school lectures, streams PCM to Azure MAI-Transcribe-2-Streaming over a Vite WebSocket proxy, and shows live transcript, segment list, waveform, VAD meter and playback controls.
- Queue confirmed transcript segments into the AI while audio keeps playing; lecture requests run one at a time, coalesce under lag and let the model answer `WAIT` for incomplete sentences.
- Use low-latency live reasoning and incremental drawing prompts so the board grows with the session instead of waiting for a final plan.
- Add ten meeting and planning cases with generated Chinese, English and Japanese audio, plus the source scripts and a reusable real-daemon case runner.
- Add a post-session summary action and automatic summary when a live session ends; the assistant checks layout warnings, fixes overlaps, then builds one rich HTML summary card.
- Give `get_board` layout warnings for overlaps and frame escapes, and map vivid colors to note tint fills instead of failing the tool.
- Enforce a two-column live layout, cap section width, treat duplicate create ids as updates, and allow richer HTML/text in cards and notes.
- Add a real-session case library and round artifacts under `evals/runs/`.
- Pin each AI request to the active canvas, guard stale updates, sanitize interrupted tool calls, and block scripts and external resources in HTML cards.
- Add multiple saved canvases with names, timestamps and generated SVG previews; the top-left Canvases panel creates, switches, renames and deletes them.
- Keep one shared active canvas across browser clients, the HTTP API and the CLI; switching clears transient interaction and fits the new board.
- Add full canvas management to the agent API and CLI, including per-canvas operations, `--canvas` targeting, state snapshots and WebSocket canvas events.
- Migrate existing single-board databases to a canvas named “My canvas” automatically.
- Gate pushes and pull requests with a base-ci quality workflow that declares every System0 slot; CI runs types, zero-warning lint, workflow lint, secret and dependency scans, the build, unit and integration tests, and a browser E2E subset.
- Split the Node suite into L1 and L3 partitions through `scripts/run-tests.ts`, so a test file in a new directory is discovered instead of silently skipped.
- Fail `pnpm lint` on warnings, exclude the frozen prototype references from Biome, and build the WebSocket probe key at runtime so the secret scan stays clean.

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
