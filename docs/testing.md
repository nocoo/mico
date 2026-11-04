# Automated testing

Mico has a collection of canvases but three interfaces over them: the browser canvas, the HTTP API, and the agent CLI. Tests are layered so a defect is caught at the cheapest layer that can see it, while the agent-facing API keeps an explicit contract of its own.

## Layers

| Layer               | Files                                                                                                                          | What it proves                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pure logic          | `src/web/{anchors,brush,canvasState,connections,containers,design,grid,move,selection,snap,viewport}.test.ts`                  | Geometry, containment, snapping, connector anchors and classes, brush sampling, palette/token contract. No DOM, no database.                                                                     |
| Store contract      | `src/server/store.test.ts`, `src/server/preview.test.ts`                                                                       | Canvas CRUD and switching, per-canvas revisions, shape schema, atomic batches, frame rules, delete cascades, SQLite migration, previews, legacy cleanup.                                         |
| HTTP API contract   | `src/server/api.test.ts`, `src/server/index.test.ts`                                                                           | Canvas CRUD and state snapshots, status codes and error envelopes, every shape type over the wire, patch scoping, revision guards, CORS/host/preflight, WebSocket snapshots and broadcasts.      |
| CLI                 | `src/cli/index.test.ts`                                                                                                        | Every `mico` command against a real daemon on an ephemeral port, canvas CRUD/switching, `--canvas` targeting, generated ids, stdin/file batches, conflict and usage failures.                    |
| Agent examples      | `scripts/examples.test.ts`                                                                                                     | The JSON/TypeScript batches shipped for agents still validate and apply, including the frame + HTML dashboard example. Duplicate application fails explicitly.                                   |
| Browser interaction | `tests/browser/canvas.spec.ts`, `tests/browser/canvases.spec.ts`, `tests/browser/controls.spec.ts`, `tests/browser/ai.spec.ts` | Canvas panel switching/rename/delete/previews, AI panel chat and audio tabs, real pointer and keyboard input, panels, selection, dragging, membership, connectors, HTML rendering, zoom and fit. |
| Ops fixtures        | `scripts/eval-fixture.test.ts`                                                                                                 | Eval capture paths, identities, locks and artifact retention.                                                                                                                                    |

## Commands

```sh
pnpm check          # Biome + TypeScript
pnpm test           # every Node test layer
pnpm test:unit      # pure logic + store
pnpm test:api       # HTTP/WebSocket daemon contract
pnpm test:cli       # real daemon + CLI
pnpm test:examples  # agent example batches
pnpm test:browser   # Playwright, isolated Vite + daemon
pnpm build
```

## Isolation

- Never point an automated test at the daily board (`.mico/board.sqlite`) or the daily ports.
- Store/API/CLI/example tests use `mkdtempSync` databases and port `0`.
- The browser fixture (`scripts/browser-server.ts`) owns `127.0.0.1:27063`, an ephemeral daemon, a temporary SQLite file and a separate Vite cache. Every spec refuses to run against another origin.
- `pnpm test:browser` runs one worker at a time; tests reset the board through the API at the start of each case.
- Do not run a dev server for tests. The Playwright config starts and stops its own fixture.

## Browser conventions

- `tests/browser/support.ts` holds the shared API helpers (`board`, `resetBoard`, `shapeOf`), world/screen conversion (`worldView`, `worldPoint`, `dragWorld`, `clickWorld`), and control lookup (`clickPathInk`, `pillBox`, `choose`).
- Prefer real input (`page.mouse`, `page.keyboard`) and poll the stored board with `expect.poll`. Use DOM locators only to find a hit target, not to mutate application state directly.
- Derive screen coordinates from the world transform rather than hard-coding pixels; the initial viewport fit is not a stable fixture.
- SVG `foreignObject` content needs a real HTML locator (`.card-pill`, `input`, `textarea`); an SVG group's bounding box includes unpainted foreignObject area.
- Always wait for UI state that depends on a pending operation (selection panel, option popover closed, board revision) before the next input.

## Agent API contract

`GET /api/state` returns `{stateVersion, activeCanvasId, canvases, board}`; `?previews=0` omits previews, and `stateVersion` orders delayed snapshots. Canvas summaries carry `id`, `name`, `revision`, `createdAt`, `updatedAt` and a 160×100 SVG data-URL preview. Canvas management uses `GET/POST /api/canvases` (also supports `?previews=0`), `GET/PATCH/DELETE /api/canvases/:id` and `PUT /api/active-canvas`; every metadata response is the updated state snapshot. The last canvas cannot be deleted (`LAST_CANVAS`).

`POST /api/operations` accepts `{ operations, expectedRevision?, canvasId? }`. It defaults to the active canvas and can target any canvas without switching. A batch is validated and persisted atomically per canvas; `expectedRevision` rejects stale writers with `409 REVISION_CONFLICT`.

- `create` carries a complete shape. `update` carries `{ id, patch }`; patch keys are scoped per shape type. `delete` removes the shape, its connectors and releases frame members.
- Shape types: `rectangle`, `ellipse`, `text`, `line`, `note`, `path`, `frame`, `html`, `connector`.
- `frame` needs a title, has no `frameId` (no nesting) and only connects to other frames.
- `html` needs a title and markup up to 200 000 characters; it may sit inside a frame but can never be the target of `frameId`.
- Regular shapes carry optional `frameId` naming an existing frame. Connector endpoints must both be frames or both be non-frames; anchor pins are range-checked per type.
- Errors use `{ error, message }`: `INVALID_REQUEST` (400), `INVALID_JSON` (400), `DUPLICATE_ID` (400), `NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `FORBIDDEN_HOST`/`FORBIDDEN_ORIGIN` (403), `REVISION_CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413) and `INTERNAL_ERROR` (500). Bodies above 1 MB are drained so the client receives an explicit 413 instead of a reset connection.
- `GET /api/board` returns the active `{ revision, shapes }`. The WebSocket at `/api/events` sends a `snapshot` on connect and after canvas create/rename/delete/switch, and a `board` event after operations: `{ type: "board", canvasId, canvas, board }`. Rejected batches and foreign origins never broadcast.

Agent examples are executable specifications: `examples/architecture.json`, `examples/agent-canvas-map.json`, `examples/sketch.ts`, `examples/distributed-architecture.ts`, and `examples/frame-dashboard.ts`. Update an example together with the API and its test.

## Coverage map

| Area                                | Primary coverage                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Tool buttons and shortcuts          | `controls.spec.ts` keyboard/tool tests, `canvas.spec.ts` toolbar test                                                        |
| Shape creation by drag/click        | `controls.spec.ts` primitive tests, `canvas.spec.ts` note/text/brush tests                                                   |
| Dock options (colors, brush, fonts) | `controls.spec.ts` option and panel tests                                                                                    |
| Selection, marquee, delete          | `canvas.spec.ts` marquee/snap tests, `controls.spec.ts` keyboard test                                                        |
| Properties panel                    | `controls.spec.ts` panel test, `canvas.spec.ts` note/text/html/frame edits                                                   |
| Frame label, membership, travel     | `canvas.spec.ts` frame tests, `controls.spec.ts` membership test, `containers.test.ts`                                       |
| Connector creation/rebind/classes   | `canvas.spec.ts` connector tests, `connections.test.ts`, `api.test.ts`                                                       |
| HTML cards                          | `controls.spec.ts`, `canvas.spec.ts` HTML test, `store.test.ts`, `api.test.ts`, examples test                                |
| Pan/zoom/fit                        | `controls.spec.ts` zoom test, `canvas.spec.ts` grid/viewport test                                                            |
| Canvas management and previews      | `canvases.spec.ts`, `canvasState.test.ts`, `store.test.ts`, `preview.test.ts`, `api.test.ts`, `index.test.ts` (HTTP and CLI) |
| AI assistant panel                  | `ai.spec.ts`, `aiChat.test.ts`                                                                                               |
| Palette and tokens                  | `design.test.ts`, `controls.spec.ts` panel/default-colour checks                                                             |
| Store schema and atomicity          | `store.test.ts`, `api.test.ts`                                                                                               |
| HTTP/WebSocket contract             | `api.test.ts`, `index.test.ts`                                                                                               |
| CLI                                 | `src/cli/index.test.ts`                                                                                                      | Every `mico` command against a real daemon on an ephemeral port, canvas CRUD/switching, `--canvas` targeting, generated ids, stdin/file batches, conflict and usage failures. |
| Agent examples                      | `examples.test.ts`                                                                                                           |

## Known gaps

- No visual regression baselines; screenshots are failure artifacts, not assertions.
- Browser tests run Chrome only. Safari/Firefox rendering of `foreignObject` and sandboxed iframes is unverified.
- No load, soak or large-board performance tests; the 1 MB request limit is exercised for the 413 contract only.
- Not yet supported by the product, so not tested: undo/redo, resizing, multi-user sessions, MCP, remote deployment.
