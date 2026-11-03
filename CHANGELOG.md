# Changelog

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
