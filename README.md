# Mico

A local-first canvas experiment where people and local agents edit the same board. The browser renders the canvas; the daemon owns the board and stores it in SQLite; the CLI gives agents direct access to the same operations.

## Requirements

- Node.js 24 or newer
- pnpm

## Run

```sh
pnpm install
pnpm daemon
```

In another terminal:

```sh
pnpm dev
```

Open <https://mico.dev.hexly.ai/>. Caddy proxies to Vite on `127.0.0.1:7063`; Vite proxies `/api` (including WebSocket upgrades) to the loopback-only daemon on `127.0.0.1:37063`. The browser uses same-origin HTTPS/WSS, never mixed-content loopback requests. The daemon stores its board in `.mico/board.sqlite`.

Vite hot-reloads frontend changes; `pnpm daemon` watches daemon source changes and restarts automatically. API and CLI writes update open canvases live over WebSocket, with automatic reconnection and a three-second polling fallback. `MICO_PORT` overrides the daemon port for the daemon, CLI, and Vite proxy; set it consistently in both terminals. `MICO_DB_PATH` overrides the database path.

Port allocation: development `7063`, E2E `17063`, browser/BDD `27063`, internal daemon `37063`. Automated tests must use an isolated database and loopback endpoint, not the daily board. The shared Caddy mapping lives in `workflow/caddy/Caddyfile` and the active machine's `/opt/homebrew/etc/Caddyfile`; the existing `*.dev.hexly.ai` certificate covers this hostname.

The canvas supports panning, zooming, rectangles, ellipses, text, lines, connectors, dragging, color and deletion. Boards fit the viewport on first load; click Fit or press F to fit all objects again. Select the hand tool or hold Space and drag to pan. For connectors, select the connector tool and drag from a source node toward a target. Nearby nodes reveal their anchors; the highlighted anchor is the exact persisted attachment. Select a connector to drag either endpoint to another node. Dropping on empty space, cancelling a pointer, or pressing Escape leaves it unchanged. Source and Target controls in the dock properties provide a keyboard alternative. Concurrent agent edits are checked before committing a drag.

Dragging an object snaps its origin to the visible 16px grid and aligns left/right/center or top/bottom/middle with nearby objects within six screen pixels. Matching alignments show dashed guide lines and win over the grid on that axis. Objects farther than 160 screen pixels never attract.

The canvas uses a subtle blueprint grid: a solid line every 64px with four dashed cells between solid lines at 100% zoom. The grid follows world pan and zoom; dashed detail fades at low zoom to avoid moiré.

The identity panel shows only the logo and a breathing connection light, and the unified bottom dock is fixed in screen space: canvas pan and zoom never resize, move or hide them. Drawing tools, zoom/reset, Fit and the selected object's properties share one dock; narrow viewports wrap its controls instead of clipping them. The color panel opens above the dock. Controls use fixed 40px height, 20px icons and 14px text on an eight-pixel layout system, with Lucide icons and hover-only shortcut hints. Toolbar arrow keys move focus; Enter selects a tool.

## Agent CLI

Commands write JSON to standard output; errors go to standard error and return a nonzero exit code. The CLI talks directly to the local daemon without a model provider or cloud service.

```sh
node src/cli/index.ts board get
node src/cli/index.ts shape create '{"type":"rectangle","x":100,"y":100,"w":180,"h":80,"color":"#5b5fc7","text":"Hello"}'
node src/cli/index.ts shape update <id> '{"x":300,"y":200}'
node src/cli/index.ts shape delete <id>
node src/cli/index.ts batch examples/architecture.json
node examples/distributed-architecture.ts | node src/cli/index.ts batch -
```

The distributed-commerce example adds 20 services and clients, 27 connectors, and six headings to the right of the original Mico diagram without deleting existing objects. Its fixed `commerce-` IDs make duplicate application fail atomically. Click Fit after adding it to an open board.

`shape create` generates an ID if one is omitted. A batch is an array of `create`, `update`, or `delete` operations; use `-` instead of a filename to read JSON from standard input. Batch-created shapes must include IDs so that connectors can refer to them. The example uses fixed IDs and can be applied once to an empty board. Deleting a shape also deletes connectors attached to it; connector endpoints must be different.

A canvas shape has `id`, `type` (`rectangle`, `ellipse`, `text`, or `line`), `x`, `y`, `w`, `h`, `color` (six-digit hex), and optional `text`. For a line, `w` and `h` are signed offsets to its endpoint. A connector has `id`, `type: "connector"`, `from` and `to` shape IDs, and `color`. Optional `fromAnchor` and `toAnchor` pin either endpoint to an exact anchor index: boxes/text/ellipses have 12 anchors, lines have five. Pins must be non-negative integers inside the referenced node's anchor range; invalid pins reject the entire batch. Unpinned endpoints use automatic nearest-outward routing. Pinned attachments follow their nodes as they move.

The daemon exposes `GET /api/live` (status and manifest-derived version), `GET /api/board`, `POST /api/operations`, and a WebSocket at `/api/events`. A batch is validated and persisted atomically. An optional `expectedRevision` rejects writes based on stale board state. WebSocket subscribers receive the complete current board on connection and after each mutation.

## Verification

```sh
pnpm check
pnpm test
pnpm build
pnpm test:browser
```

Browser checks require installed Google Chrome and run sequentially on `127.0.0.1:27063`, with an isolated daemon on `57063`, a temporary SQLite database, and a separate Vite cache. The suite refuses to seed another origin and never changes the daily `.mico` board. It covers frame alignment, icon/tooltip behavior, dock property editing, drag snapping with alignment guides, connector creation/rebinding/cancellation, keyboard alternatives, concurrent API edits, grid/world alignment and unchanged frame geometry from 5% to 300% zoom. Responsive checks keep every dock control and its color panel visible at narrow and wide widths.

## MVP limits

This is a single local board, not a multi-user server. It has no authentication beyond restricting browser origins and hosts, and trusts processes running on the local machine. Do not expose the daemon to a network. Undo/redo, resizing, remote deployment, and MCP are not implemented yet.
