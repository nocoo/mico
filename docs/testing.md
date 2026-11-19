# Automated testing

Mico has a collection of canvases but three interfaces over them: the browser canvas, the HTTP API, and the agent CLI. Tests are layered so a defect is caught at the cheapest layer that can see it, while the agent-facing API keeps an explicit contract of its own.

## Layers

The Node layers feed L1 (pure logic, store, STT) or L3 (HTTP API, CLI, agent examples); the browser layers feed L4.

| Layer               | Files                                                                                                                                                                                                                 | What it proves                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pure logic          | `src/web/{anchors,brush,canvasState,connections,containers,design,grid,move,selection,snap,viewport}.test.ts`, `src/web/canvas/{draft,pendingCreations,history,minimap}.test.ts`, `src/web/whiteboards/scope.test.ts` | Geometry, containment, snapping, connector anchors and classes, brush sampling, palette/token contract, creation drafts, pending-creation states, meeting-scope URLs. No DOM, no database.                                                                                                                               |
| Store contract      | `src/server/store.test.ts`, `src/server/preview.test.ts`, `src/server/storage-backends.test.ts`, `src/server/storage-postgres.test.ts`, `src/server/boardEvent.test.ts`                                               | Canvas CRUD and switching, per-canvas revisions, shape schema, atomic batches, frame rules, delete cascades, SQLite migration, previews, legacy normalization, PostgreSQL snapshot/blob behavior, one board-event shape.                                                                                                 |
| HTTP API contract   | `src/server/api.test.ts`, `src/server/index.test.ts`                                                                                                                                                                  | Canvas CRUD and state snapshots, status codes and error envelopes, every shape type over the wire, patch scoping, revision guards, CORS/host/preflight, WebSocket snapshots and broadcasts.                                                                                                                              |
| CLI                 | `src/cli/index.test.ts`                                                                                                                                                                                               | Every `mico` command against a real daemon on an ephemeral port, canvas CRUD/switching, `--canvas` targeting, generated ids, stdin/file batches, conflict and usage failures.                                                                                                                                            |
| Agent examples      | `scripts/examples.test.ts`                                                                                                                                                                                            | The JSON/TypeScript batches shipped for agents still validate and apply, including the frame + HTML dashboard example. Duplicate application fails explicitly.                                                                                                                                                           |
| AI pipeline eval    | `scripts/ai-pipeline-eval.ts`, `scripts/ai-pipeline-eval.test.ts`, `evals/cases/layered-eval-suite.json`                                                                                                              | Offline deterministic L1–L5 checks for tool schema size, parallel serialization, static KV prefix, 180-shape anchor retention, 120-turn compaction, VAD/queue lag recovery, multi-topic swimlanes, plus `--live --case <id> --confirm-provider-usage` rubric grading (`c12`–`c15`).                                      |
| Browser interaction | `tests/browser/canvas.spec.ts`, `tests/browser/canvases.spec.ts`, `tests/browser/controls.spec.ts`, `tests/browser/ai.spec.ts`, `tests/browser/canvas-regressions.spec.ts`                                            | Canvas panel switching/rename/delete/previews, AI streaming/tool loop/selection/URL trigger, session catalogue/controls, audio tab, real pointer and keyboard input, panels, selection, dragging, membership, connectors, HTML rendering, zoom and fit, independent-create resilience and meeting-scoped drawing/images. |
| Ops fixtures        | `scripts/eval-fixture.test.ts`                                                                                                                                                                                        | Eval capture paths, identities, locks and artifact retention.                                                                                                                                                                                                                                                            |

## Commands

```sh
pnpm check              # Biome with zero warnings + TypeScript
pnpm test               # every Node test file under src/ and scripts/
pnpm test:unit          # L1: pure logic, store, STT and component logic
pnpm test:integration   # L3: real daemon over HTTP/WebSocket, CLI, agent examples
pnpm eval:ai            # Offline L1-L5 AI pipeline metrics & threshold check
pnpm test:e2e           # L4: canvas, overview, cards, audio and dialog geometry
pnpm test:browser       # L4: every Playwright spec
pnpm build
```

`scripts/run-tests.ts` discovers every `*.test.ts` under `src/` and `scripts/` and splits the set in two. The files listed in its `INTEGRATION` constant run against a real daemon, ephemeral port and temporary SQLite file (L3); everything else is pure logic (L1). `pnpm test` runs the discovered set itself, so a test file in a new directory can never be skipped — move it into `INTEGRATION` when it needs a live daemon.

## Quality slots

`.github/workflows/ci.yml` delegates to `./.github/workflows/quality-slots.yml` in System1 native mode (using `nocoo/base-ci` composite actions pinned to a full commit SHA). Only one check needs branch protection: `quality / Z1: Gate`.

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
- `pre-push` walks the refs on stdin, creates a detached worktree for each pushed OID, and runs B1 build, L3 integration and G2 `osv-scanner` against that OID's lockfile. It verifies that the installed lockfile matches the pushed OID, then invokes the installed build binaries directly so pnpm cannot relink the shared `node_modules` from the temporary worktree. Deletions are skipped.

L4 stays in CI: the browser subset takes about three minutes, above the 2.5-minute pre-push target. Missing build binaries, `gitleaks` or `osv-scanner` fail the gate; never bypass it with `--no-verify`.

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

In demo mode (`MICO_AUTH_MODE=demo`), only the active presenter in the `demo` presence room can create, switch, rename, or delete canvases. These requests must carry the presenter's `X-Mico-Whiteboard` session token (or `whiteboardsession` query parameter). Guests and requests without a session receive `403 WHITEBOARD_READ_ONLY`; the browser displays the server's hint to become or request presenter through **Workspace profile**. With no presenter, users must first claim that role. Canvas lists and the active canvas remain shared, and everyone can still draw and read canvases. Non-demo canvas management is unchanged. Demo roles remain self-declared, not an identity-based access control system.

Demo object edits also require a joined session. Participants can create objects and edit/delete only their own, unless the presenter grants edit access to that particular canvas. The presenter can edit every object. **Workspace profile** exposes **Grant edit** / **Revoke edit** for online members and revocation for offline grantees. Grants include editing/deleting all objects, not canvas management or AI access, and persist until revoked, including across reloads and server restarts. Existing objects without ownership require presenter or granted access. Ownership and grants are tenant-scoped, including isolated `meetingId` rooms; HTTP and initial WebSocket snapshots carry the same ownership metadata. Actor-scoped stores retain the configured SQL and blob backends.

Demo board responses and broadcasts include server-assigned `objectOwners` for current objects. The browser uses this metadata to block protected-object drag previews and inline editors, hide the selected-object editing panel unless every selected object is editable, disable editing toolbar actions, and cancel unauthorized in-progress edits when access is revoked. Protected objects remain selectable, but their editing panel is not shown; granting or revoking access updates panel visibility immediately. Transactional server checks remain authoritative, including for cascades and stale clients.

Operation failures display the server-provided message, falling back to the HTTP status when no message is available. The action and canvas browser regressions assert these messages; the selection-dialog regression checks that editable properties still scroll in short viewports.

The browser keeps a private random `mico.demo.participantKey` in local storage and sends it when joining. The server exposes only its hashed `participantId` in presence. Ownership follows that browser profile, not the display name or a single tab; clearing storage loses that identity. API clients can persist an optional UUID `participantKey` when joining; otherwise ownership follows their private `clientId`. These identifiers are bearer secrets, not authenticated user identities. Do not share them. Storage restrictions are surfaced as join errors rather than silently losing ownership.

`PUT /api/canvases/:id/permissions` accepts `{participantId, allowed}` and requires the demo presenter. Demo snapshots include `canvasEditorIds` for the active canvas; updates are broadcast and polled like canvas snapshots. Object creation is server-attributed. Batch edits, action checkboxes, undo/redo restores, and delete cascades check ownership transactionally; a batch affecting any unauthorized object fails atomically with `403 OBJECT_EDIT_FORBIDDEN` and a request-to-presenter hint. Deleting your own frame or connected object may also affect someone else's objects and therefore require a grant. Ownership tombstones preserve the original owner through deletion/restore and prevent ID reuse from claiming another person's object. Non-demo object APIs are unchanged.

The live topbar uses live demo participants (including local Presenter/Guest mode), with a ring and presentation badge on the active presenter. Accessible avatar labels identify the presenter and yourself. The highlight follows presenter transfers; outside presence mode, the bar shows the local workspace identity. `tests/browser/whiteboards.spec.ts` verifies the highlight on both clients before and after a handoff. Live recording controls retain their existing AI/presenter availability rules.

Participants granted edit access to the active demo canvas use the same accent ring with a pencil badge and a **canvas editor** tooltip/accessibility label. The presenter retains the presentation badge. Editor highlights follow stable participant identity (not display names), update on grant/revoke and canvas switches, and do not appear merely because someone can edit their own objects.

Visual examples: [before](images/presenter-avatar-before.png), [after](images/presenter-avatar-after.png), and [compact dark mode](images/presenter-avatar-dark.png).

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

| Area                                | Primary coverage                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tool buttons and shortcuts          | `controls.spec.ts` keyboard/tool tests, `canvas.spec.ts` toolbar test                                                                                                                                  |
| Shape creation by drag/click        | `controls.spec.ts` primitive tests, `canvas.spec.ts` note/text/brush tests, `canvas-regressions.spec.ts` independent-create and lost-ack tests                                                         |
| Dock options (colors, brush, fonts) | `controls.spec.ts` option and panel tests                                                                                                                                                              |
| Selection, marquee, delete          | `canvas.spec.ts` marquee/snap tests, `controls.spec.ts` keyboard test                                                                                                                                  |
| Properties panel                    | `controls.spec.ts` panel test, `canvas.spec.ts` note/text/html/frame edits                                                                                                                             |
| Frame label, membership, travel     | `canvas.spec.ts` frame tests, `controls.spec.ts` membership test, `containers.test.ts`                                                                                                                 |
| Connector creation/rebind/classes   | `canvas.spec.ts` connector tests, `connections.test.ts`, `api.test.ts`                                                                                                                                 |
| HTML cards                          | `controls.spec.ts`, `canvas.spec.ts` HTML test, `store.test.ts`, `api.test.ts`, examples test                                                                                                          |
| Pan/zoom/fit                        | `controls.spec.ts` zoom test, `canvas.spec.ts` grid/viewport test                                                                                                                                      |
| Canvas management and previews      | `canvases.spec.ts`, `canvasState.test.ts`, `store.test.ts`, `preview.test.ts`, `api.test.ts`, `index.test.ts` (HTTP and CLI)                                                                           |
| AI assistant panel                  | `ai.spec.ts`, `ai.test.ts`, `aiAudio.test.ts`                                                                                                                                                          |
| Palette and tokens                  | `design.test.ts`, `controls.spec.ts` panel/default-colour checks                                                                                                                                       |
| Store schema and atomicity          | `store.test.ts`, `api.test.ts`                                                                                                                                                                         |
| Tenant isolation                    | `tenant.test.ts` (separate lists, canvases, active canvas, state version, images; cross-tenant 404), `auth.integration.test.ts` (a signed-in identity edits a workspace the `local` tenant cannot see) |
| HTTP/WebSocket contract             | `api.test.ts`, `index.test.ts`                                                                                                                                                                         |
| Resilient creation                  | `canvas-regressions.spec.ts` concurrent/lost-ack/rejected-create tests, `pendingCreations.test.ts`, `draft.test.ts`, `api.test.ts` create contract                                                     |
| Meeting scope and assets            | `whiteboards.spec.ts` unicode meeting and scoped-image tests, `scope.test.ts`, `client.ts` request construction                                                                                        |
| Idle updates and polling            | `frame-regression.spec.ts` update-depth guard, `session-races.spec.ts` switch intent and single-flight poll, `canvasState.test.ts` duplicate-apply guard                                               |
| CLI                                 | `src/cli/index.test.ts`                                                                                                                                                                                | Every `mico` command against a real daemon on an ephemeral port, canvas CRUD/switching, `--canvas` targeting, generated ids, stdin/file batches, conflict and usage failures. |
| Agent examples                      | `examples.test.ts`                                                                                                                                                                                     |

## Overview and browser history

- `src/shared/overview.test.ts`, `src/web/canvas/minimap.test.ts` and `src/server/preview.test.ts` cover shared block extraction, ignored text/line bounds, projection, negative/empty/extreme geometry, navigation and bounded SVG output.
- `src/web/canvas/history.test.ts` and `src/server/history.test.ts` cover the fixed 20-step limit, branching, exact optional fields, delete cascades, frame/image references, stacking order, image limits and conflicts with external work.
- `tests/browser/minimap.spec.ts` and `tests/browser/history.spec.ts` cover real pointer/keyboard navigation, canvas-list previews, responsive placement, undo/redo buttons and shortcuts, native text editing, canvas switching, refresh, request rejection and unrelated/concurrent API edits.

## Tenancy

`src/server/tenant.test.ts` covers the resolver (anonymous requests map to `local`, each identity to its own stable opaque tenant) and storage isolation: separate canvas lists, defaults, active canvas, `stateVersion` and image assets, plus not-found answers for another tenant's canvas id and image id. `src/server/auth.integration.test.ts` proves a signed-in user's private workspace stays invisible to the `local` tenant. There is no separate shared-board collection: multi-user sessions are presence rooms inside one tenant, and a `meetingid` query parameter or `X-Mico-Meeting` header hashes that meeting into its own tenant (`src/server/tenant.ts`).

`src/server/whiteboards.integration.test.ts` covers the demo presence contract: presenter-managed canvases, presenter admission races, role enforcement, room-scoped broadcasts, cursor and presenter-view events, presenter departure and hand-over, AI gating to the presenter, and `meetingid` isolation between rooms. `tests/browser/whiteboards.spec.ts` uses independent pages to exercise the demo profile, presenter and guest drawing, presenter requests and transfers, the local mode switcher, the presenter request dialog and remote selection highlights. All fixtures use isolated databases and mock AI; they do not prove live provider access.

## Asynchronous storage safety

`src/server/sql.test.ts` exercises transaction rollback and concurrent SQLite handles. `store.test.ts`, `tenant.test.ts` and `storage-concurrency.test.ts` cover atomic initialization/migration, reopening personal workspaces without duplicate defaults, draining accepted writes before close, last-canvas protection across handles, generated-image revision rollback and concurrent image limits without orphan assets. A per-handle mutex alone is not evidence of database atomicity.

`storage-postgres.test.ts` starts a private throwaway PostgreSQL cluster over a Unix socket when the server binaries are available. It proves that read projections use one stable snapshot, reads perform no writes or legacy rewrite, a legacy normalization cannot overwrite a newer committed board, shutdown drains an admitted write, and generated images are readable through the configured BlobStore. The same file skips only when no PostgreSQL binaries are installed. The former D1 + R2 adapter was removed because D1 has no interactive transactions for these rollback guarantees; `MICO_STORAGE_BACKEND=cloudflare` now fails explicitly.

`index.test.ts` checks that failed storage initialization cannot return healthy and that daemon cleanup propagates errors. `production.test.ts` runs the actual process entrypoint to prove initialization failure exits before listening and SIGTERM drains an in-flight write. `backend-regressions.test.ts` gates an AI frame-member write behind a concurrent frame move; `imageGeneration.test.ts` controls job admission and completion around concurrent start/close calls. These fixtures use temporary databases and synthetic generators only.

## AI runtime configuration

`src/server/aiConfig.test.ts` and `aiSettings.test.ts` cover the laptop/deploy source policy, environment validation, managed-identity settings isolation and saved credentials. `managedIdentity.test.ts` verifies the shared Foundry audience cache, expiry refresh, cancellation and redirect/credential protection; `managedIdentity.integration.test.ts` belongs to L3 and exercises real daemon Chat/model HTTP routes and asynchronous MAI proxy authentication with mocks. `src/server/aiConfig.integration.test.ts` runs in L3 and verifies deploy startup never imports local `.env` values, HTTP updates are blocked, and environment credentials reach mock model requests. Realtime and image tests check configured endpoints, headers and image model forwarding. `tests/browser/assistant-dialog.spec.ts` verifies the read-only UI without upstream model requests; editable local settings remain covered in `tests/browser/ai.spec.ts`.

`tests/browser/managed-ai.spec.ts` verifies managed Settings without key fields and disabled MOSS with MAI selected. Normal automated suites never call paid providers. The separately authorized `node scripts/verify-managed-ai.ts --confirm-provider-usage --audio <pcm16-file>` check runs inside the actual managed-identity deployment, creates its own loopback daemon and temporary database, exercises real Chat tool writes and MAI transcription, and never changes the public daemon's authentication or live board. `scripts/verify-managed-ai.test.ts` checks its confirmation and audio-size guards without provider traffic.

## Docker acceptance

`docker compose --env-file /dev/null build && node scripts/docker-smoke.ts` checks the actual production image on `127.0.0.1:47063` using a unique Compose project, isolated volumes, empty provider credentials and headless Chrome. It covers UI drawing, API/WebSocket synchronization, audio ranges, image storage, CLI access, security boundaries and persistence after container recreation. It cleans up only its own containers and volumes, retaining screenshots and logs in the OS temporary directory. See [docker.md](docker.md). On macOS without Docker Desktop, run `node scripts/container-smoke.ts` using `apple/container` instead.

`src/server/production.test.ts` and `src/server/realtimeProxy.test.ts` run in L3 without Docker. They cover production asset serving, HTTP caching/ranges, missing-file and source-file rejection, same-origin API/events, provider upgrade routing, missing credentials and mock upstream forwarding.

## Linux visual parity

The action-card pixel comparison retains its 0.002 mismatch limit and attaches both reference and actual images for each checkbox state. Its heading must allow synthesized weight, like the frozen prototype, when Linux falls back to a CJK font without a bold face. Assistant geometry checks retain zero horizontal overflow and cover desktop plus the 401/400/391px label-to-icon boundary.

When reproducing CI locally, use the repository's Playwright version on Ubuntu with `fonts-dejavu-core` installed, matching the GitHub runner's system-font fallback. The stock Playwright Docker image alone can select a narrower fallback and miss these defects. Do not solve font-dependent layout failures by relaxing pixel thresholds or adding retries.

## Hosted preview

`src/server/runtime.test.ts` covers independent hosting/auth/AI settings; `src/web/runtime.test.ts` and `src/web/msal.test.ts` cover browser session and callback policy. `src/server/auth.integration.test.ts` verifies real HTTP and WebSocket authentication against temporary SQLite and synthetic identity keys. It must remain in the L3 list in `scripts/run-tests.ts`.

`tests/browser/hosted.spec.ts` belongs to the CI E2E subset. It checks fail-closed runtime bootstrap, optional login, callback/session handling, logout/expiry and manual drawing with AI disabled. Local identity doubles do not prove the real Entra redirect is registered.

`tests/browser/debug-panel.spec.ts` and `avatar.spec.ts` also run in that subset. They cover the identity-entry order, Canvas List/Debug mutual exclusion, keyboard focus, outside pointer gestures, glass-token parity, 320px portrait and authenticated 812×375 landscape layout, optional photo display and object-URL revocation. Screenshots are captured after entrance animations complete. MSAL and Graph are intercepted only by the browser fixture; no production mock hook or real profile request is used. Missing photos, permission errors and invalid image bytes must leave a usable fallback. `src/web/avatar.test.ts` and `frame-debug.test.ts` cover the bounded photo request, cancellation, account choice and pure display state in L1.

`scripts/cloud/azure.test.ts` verifies environment-driven target selection, distinct login/resource tenants, explicit optional authentication, digest pinning, one replica and the ephemeral/AI-disabled deployment contract. Azure provisioning and actual image health are separate live acceptance steps, not mocked unit-test results. Provider-specific IDs and deployment URLs must stay in operator configuration outside Git.

## Known gaps

- Pixel comparisons cover the pinned prototype's light-theme backdrop, notes, shapes, text, ink, connector, selection marquee and HTML card shell. Other themes, arbitrary generated card contents and all animation frames are not exhaustively compared.
- Browser tests run Chrome only. Safari/Firefox rendering of `foreignObject` and sandboxed iframes is unverified. MOSS Live does not automatically request a summary when stopped.
- No load, soak or large-board performance tests; the 1 MB request limit is exercised for the 413 contract only.
- Not yet supported by the product, so not tested: resizing, MCP and durable managed-cloud storage. Multi-user sessions do exist, but only as presence rooms inside one tenant: they are single-replica, and every member shares that tenant's boards instead of a separate shared collection. Azure is the first automated disposable preview; other cloud adapters and a real Entra login require separate acceptance.
- PostgreSQL interleaving tests require local server binaries; without them those cases skip rather than fail. The Cloudflare D1/R2 backend is removed and rejected by configuration because it cannot provide BoardStore's transaction rollback; Cloudflare-native deployment remains unsupported.
