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

The canvas supports panning, zooming, rectangles, ellipses, text, lines, connectors, dragging, color and deletion. Select the hand tool or hold Space and drag to pan. For connectors, select the connector tool, then click the source and target objects. Connectors automatically choose the nearest fixed anchor points and may switch anchors as objects move.

## Agent CLI

Commands write JSON to standard output; errors go to standard error and return a nonzero exit code. The CLI talks directly to the local daemon without a model provider or cloud service.

```sh
node src/cli/index.ts board get
node src/cli/index.ts shape create '{"type":"rectangle","x":100,"y":100,"w":180,"h":80,"color":"#5b5fc7","text":"Hello"}'
node src/cli/index.ts shape update <id> '{"x":300,"y":200}'
node src/cli/index.ts shape delete <id>
node src/cli/index.ts batch examples/architecture.json
```

`shape create` generates an ID if one is omitted. A batch is an array of `create`, `update`, or `delete` operations; use `-` instead of a filename to read JSON from standard input. Batch-created shapes must include IDs so that connectors can refer to them. The example uses fixed IDs and can be applied once to an empty board. Deleting a shape also deletes connectors attached to it; connector endpoints must be different.

A canvas shape has `id`, `type` (`rectangle`, `ellipse`, `text`, or `line`), `x`, `y`, `w`, `h`, `color` (six-digit hex), and optional `text`. For a line, `w` and `h` are signed offsets to its endpoint. A connector has `id`, `type: "connector"`, `from` and `to` shape IDs, and `color`.

The daemon exposes `GET /api/board`, `POST /api/operations`, and a WebSocket at `/api/events`. A batch is validated and persisted atomically. An optional `expectedRevision` rejects writes based on stale board state. WebSocket subscribers receive the complete current board on connection and after each mutation.

## Verification

```sh
pnpm check
pnpm test
pnpm build
```

## MVP limits

This is a single local board, not a multi-user server. It has no authentication beyond restricting browser origins and hosts, and trusts processes running on the local machine. Do not expose the daemon to a network. Undo/redo, resizing, remote deployment, and MCP are not implemented yet.
