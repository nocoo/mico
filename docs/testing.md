# Automated testing

Mico has a collection of canvases but three interfaces over them: the browser canvas, the HTTP API, and the agent CLI. Tests are layered so a defect is caught at the cheapest layer that can see it, while the agent-facing API keeps an explicit contract of its own.

## Layers

The Node layers feed L1 (pure logic, store, STT) or L3 (HTTP API, CLI, agent examples); the browser layers feed L4.

| Layer               | Files                                                                                                                                     | What it proves                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pure logic          | `src/web/{anchors,brush,canvasState,connections,containers,design,grid,move,selection,snap,viewport}.test.ts`, `src/web/canvas/*.test.ts` | Geometry, containment, snapping, connector anchors and classes, brush sampling, palette/token contract. No DOM, no database.                                                                                                                           |
| Store contract      | `src/server/store.test.ts`, `src/server/preview.test.ts`                                                                                  | Canvas CRUD and switching, per-canvas revisions, shape schema, atomic batches, frame rules, delete cascades, SQLite migration, previews, legacy cleanup.                                                                                               |
| HTTP API contract   | `src/server/api.test.ts`, `src/server/index.test.ts`                                                                                      | Canvas CRUD and state snapshots, status codes and error envelopes, every shape type over the wire, patch scoping, revision guards, CORS/host/preflight, WebSocket snapshots and broadcasts.                                                            |
| CLI                 | `src/cli/index.test.ts`                                                                                                                   | Every `mico` command against a real daemon on an ephemeral port, canvas CRUD/switching, `--canvas` targeting, generated ids, stdin/file batches, conflict and usage failures.                                                                          |
| Agent examples      | `scripts/examples.test.ts`                                                                                                                | The JSON/TypeScript batches shipped for agents still validate and apply, including the frame + HTML dashboard example. Duplicate application fails explicitly.                                                                                         |
| Browser interaction | `tests/browser/canvas.spec.ts`, `tests/browser/canvases.spec.ts`, `tests/browser/controls.spec.ts`, `tests/browser/ai.spec.ts`            | Canvas panel switching/rename/delete/previews, AI streaming/tool loop/selection/URL trigger, lesson catalogue/controls, audio tab, real pointer and keyboard input, panels, selection, dragging, membership, connectors, HTML rendering, zoom and fit. |
| Ops fixtures        | `scripts/eval-fixture.test.ts`                                                                                                            | Eval capture paths, identities, locks and artifact retention.                                                                                                                                                                                          |

## Commands

```sh
pnpm check              # Biome with zero warnings + TypeScript
pnpm test               # every Node test file under src/ and scripts/
pnpm test:unit          # L1: pure logic, store, STT and component logic
pnpm test:integration   # L3: real daemon over HTTP/WebSocket, CLI, agent examples
pnpm test:e2e           # L4: canvas, overview, cards, audio and dialog geometry
pnpm test:browser       # L4: every Playwright spec
pnpm build
```

`scripts/run-tests.ts` discovers every `*.test.ts` under `src/` and `scripts/` and splits the set in two. The files listed in its `INTEGRATION` constant run against a real daemon, ephemeral port and temporary SQLite file (L3); everything else is pure logic (L1). `pnpm test` runs the discovered set itself, so a test file in a new directory can never be skipped — move it into `INTEGRATION` when it needs a live daemon.

## Quality slots

`.github/workflows/ci.yml` calls `nocoo/base-ci`'s `quality.yml`, pinned to a full commit SHA, and declares every System0 slot in `slot-status`. Only one check needs branch protection: `quality / Z1: Gate`.

| Slot                   | Command                                 | Scope                                                       |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------- |
| S1 Types               | `pnpm typecheck`                        | every file in `tsconfig.json`                               |
| S2 Lint                | `pnpm lint`                             | `biome check --error-on-warnings`, zero diagnostics allowed |
| S3 Workflow            | actionlint 1.7.12 + immutable pin check | `.github/workflows`                                         |
| G1 Secrets             | gitleaks 8.30.1 over the checkout       | tracked files                                               |
| G2 Dependencies        | OSV Scanner over `pnpm-lock.yaml`       | single lockfile                                             |
| B1 Build               | `pnpm build`                            | Vite production bundle                                      |
| L1 Unit                | `pnpm test:unit`                        | discovered non-integration tests                            |
| L3 Integration         | `pnpm test:integration`                 | real daemon and CLI                                         |
| L4 E2E                 | `pnpm test:e2e`                         | canvas, overview, cards, audio and dialog geometry          |
| L2 Runtime, P1 Package | —                                       | `na`: plain Node runtime, private package                   |
| Z1 Gate                | base-ci aggregate                       | every `impl` slot must succeed on one SHA                   |

No Git hooks run in CI; `pnpm hooks:install` sets them up locally (see below). The first gated run took 7m15s end to end: L4 used 421s and every other slot stayed between 7s and 29s, so L4 is the only slot above the 5-minute target. Known gaps: L1 declares no coverage target or percentage, L4 runs a subset in CI while the remaining specs run locally, and `docs/prototypes/` is excluded from Biome because those files are frozen visual references that the browser suite compares against.

## Local gates

`pnpm hooks:install` points Git at `.githooks/` (`core.hooksPath`); run it once per clone. Both hooks are check-only and never rewrite the index or the working tree.

- `pre-commit` runs S2, S1 and L1 inside a snapshot of the index (`git checkout-index` into a temporary directory with `node_modules` symlinked), then G1 with `gitleaks git --staged`. An unstaged fix cannot hide a staged defect.
- `pre-push` walks the refs on stdin, creates a detached worktree for each pushed OID, and runs B1 build, L3 integration and G2 `osv-scanner` against that OID's lockfile. Deletions are skipped.

L4 stays in CI: the browser subset takes about three minutes, above the 2.5-minute pre-push target. A missing `pnpm`, `gitleaks` or `osv-scanner` fails the gate with a message; never bypass it with `--no-verify`.

## Isolation

- Install with `pnpm install --frozen-lockfile`. A plain install through a local mirror rewrites `pnpm-lock.yaml` with mirror tarball URLs, and `pnpm` 11's supply-chain check then rejects the lockfile in CI.

- Never point an automated test at the daily board (`.mico/board.sqlite`) or the daily ports.
- Store/API/CLI/example tests use `mkdtempSync` databases and port `0`.
- The browser fixture (`scripts/browser-server.ts`) owns `127.0.0.1:27063`, an ephemeral daemon, a temporary SQLite file and a separate Vite cache. Every spec refuses to run against another origin.
- `pnpm test:browser` runs one worker at a time; tests reset the board through the API at the start of each case.
- Do not run a dev server for tests. The Playwright config starts and stops its own fixture.
- The browser fixture sets `MICO_AI_MOCK=1`, so AI specs use `src/server/aiMock.ts` and never call the Magpie gateway. Keep the real gateway out of CI. Real-session evaluation is run explicitly against the daily daemon and writes only new `R<n>-…` canvases.
- Audio and microphone browser tests use isolated mock providers and synthetic audio. Real MAI transcription is a manual acceptance check because it depends on the Azure deployment and network.

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
- `restore` carries a complete `{ shape, index }` and requires `expectedRevision`. It restores the exact shape and stacking position without delete cascades; the final board references, asset IDs and five-image limit are validated atomically. This supports browser history without storing history on the server.
- Shape types: `rectangle`, `ellipse`, `text`, `line`, `note`, `path`, `frame`, `html`, `actions`, `image`, `connector`.
- `note` accepts an optional `label`. Adding a label without explicit height reserves body space atomically; unsafe automatic growth is rejected. `actions` stores a title and stable `{id, text, done}` items. `set_action_done` updates one item and requires `expectedRevision`.
- `POST /api/images` accepts raw PNG, JPEG, WebP or GIF bytes up to 10 MiB with a matching `Content-Type`, validates the signature and returns an asset ID. `GET /api/images/:id` serves the bytes. Images are stored separately from board JSON; uploads remain after shape deletion.
- `image` needs an existing asset `imageId` and may be a frame member. A frame's optional `backgroundImageId` references an image shape on the same board; `backgroundFit` is `cover`, `contain` or `stretch`. Deleting the image clears frame references.
- `frame` needs a title, has no `frameId` (no nesting) and only connects to other frames.
- `html` needs a title and markup up to 200 000 characters; it may sit inside a frame but can never be the target of `frameId`.
- Regular shapes carry optional `frameId` naming an existing frame. Connector endpoints must both be frames or both be non-frames; anchor pins are range-checked per type.
- Errors use `{ error, message }`: `INVALID_REQUEST` (400), `INVALID_JSON` (400), `DUPLICATE_ID` (400), `NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `FORBIDDEN_HOST`/`FORBIDDEN_ORIGIN` (403), `REVISION_CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413) and `INTERNAL_ERROR` (500). Ordinary JSON bodies above 1 MiB and image uploads above 10 MiB receive an explicit 413. Revision-guarded batches containing only restore/delete operations, with at least one restore, have a separate 64 MiB cap; ordinary and mixed batches retain the 1 MiB cap.
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
| AI assistant panel                  | `ai.spec.ts`, `ai.test.ts`, `aiAudio.test.ts`                                                                                |
| Palette and tokens                  | `design.test.ts`, `controls.spec.ts` panel/default-colour checks                                                             |
| Store schema and atomicity          | `store.test.ts`, `api.test.ts`                                                                                               |
| HTTP/WebSocket contract             | `api.test.ts`, `index.test.ts`                                                                                               |
| CLI                                 | `src/cli/index.test.ts`                                                                                                      | Every `mico` command against a real daemon on an ephemeral port, canvas CRUD/switching, `--canvas` targeting, generated ids, stdin/file batches, conflict and usage failures. |
| Agent examples                      | `examples.test.ts`                                                                                                           |

## Overview and browser history

- `src/shared/overview.test.ts`, `src/web/canvas/minimap.test.ts` and `src/server/preview.test.ts` cover shared block extraction, ignored text/line bounds, projection, negative/empty/extreme geometry, navigation and bounded SVG output.
- `src/web/canvas/history.test.ts` and `src/server/history.test.ts` cover the fixed 20-step limit, branching, exact optional fields, delete cascades, frame/image references, stacking order, image limits and conflicts with external work.
- `tests/browser/minimap.spec.ts` and `tests/browser/history.spec.ts` cover real pointer/keyboard navigation, canvas-list previews, responsive placement, undo/redo buttons and shortcuts, native text editing, canvas switching, refresh, request rejection and unrelated/concurrent API edits.

## Known gaps

- Pixel comparisons cover the pinned prototype's light-theme backdrop, notes, shapes, text, ink, connector, selection marquee and HTML card shell. Other themes, arbitrary generated card contents and all animation frames are not exhaustively compared.
- Browser tests run Chrome only. Safari/Firefox rendering of `foreignObject` and sandboxed iframes is unverified. MOSS Live does not automatically request a summary when stopped.
- No load, soak or large-board performance tests; the 1 MB request limit is exercised for the 413 contract only.
- Not yet supported by the product, so not tested: resizing, multi-user sessions, MCP, remote deployment.
