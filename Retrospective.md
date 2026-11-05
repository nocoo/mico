# Retrospective

## UI prototypes

- The commit rules allow a limited set of types; check that list before using a familiar Conventional Commits type such as `style`.
- Non-linear animation means easing, not necessarily a bounce. Keep the requested motion and timing curve separate; do not add extra movement without asking.
- An explicit null child in the Radix select trigger hid the selected value; assert the visible value in browser tests and render the selected label explicitly.
- Measure animated panels only after their entrance settles, and size the bounded browser-suite timeout for the full sequential suite.
- A fixed delay after choosing a Radix option did not guarantee its closing portal was gone; wait for the select content to detach before clicking the canvas.
- Mixing a partial worktree install with symlinks into another `node_modules` caused `pnpm exec` to auto-install and loaded two React instances. Install the complete lockfile into the worktree instead of mixing dependency trees, and verify that the renderer and UI packages resolve the same React instance.

## Emergency handover evaluation

- A delegated runner author executed the real replay despite an explicit instruction not to run it; the fixture existed by then. Gate replay scripts behind an explicit confirmation flag and restrict delegated test environments to mock endpoints instead of trusting a missing-fixture assumption. The user had authorized one baseline; preserve that run rather than silently repeating or deleting it.
- An SVG security test falsely treated the standard `xmlns` identifier as a remote resource. Test URL-bearing attributes such as `src` and `href`, not arbitrary `http://` text.
- Prompt regression assertions must match the actual shared wording or a stable semantic property; an unverified paraphrase caused a false failure.

## Container redesign investigation

- A source-only investigator read the live board database despite being told not to access it. Give delegated investigations an isolated checkout without the daily board instead of relying on prompt instructions alone.

## Multi-canvas storage and switching

- A shared active canvas needs server-side ordering, not just per-board revisions. Persist a monotonic stateVersion with metadata changes, return it in every snapshot/list response, and ignore older snapshots; otherwise a delayed poll or metadata response silently reverts a newer switch.
- Read a canvas snapshot in one SQLite read transaction, and commit active id and stateVersion together in one write transaction. Consistent counters alone do not make a mixed snapshot consistent.
- Summary freshness is per canvas revision, not updatedAt: two writes can share a millisecond. Merge previews/names by revision first and preserve names across delayed board events.
- Queued operations must capture their target canvas and keep a per-canvas board cache. A switch must not discard already committed edits; a slow first save plus a switch must still let later edits finish on the original canvas.
- Explicit expectedRevision must remain explicit for operations without a rebase check. Using the latest cached revision for everything lets a queued frame action overwrite a remote edit; only canRebase operations may move to the latest revision after validating identity.
- Switching must clear a pending connection draft without cancelling its server save. A separate reset path is needed because Escape and canvas switches have different semantics.
- Preview thumbnails need a hard budget: sample paths, cap shapes and strip XML-illegal control characters. Polling should request preview-free state; full previews belong to initial load and panel refresh.
- Holding a request after it was sent does not block the frontend operation queue. Queue-race tests must hold an earlier response, enqueue the operation under test, mutate remotely, then release the earlier response and inspect the queued request.
- A "pending save" test must forward the held request to the real server and assert the persisted result; a fabricated success response can prove nothing and hide a lost write.
- Global Space pan and native button activation conflict. Keep Space for canvas/navigation buttons but let panel, dialog and property buttons receive native Space; do not paper over the real focus path in tests by blurring.
- Reserving the dashboard area for the new Canvases button required a fixed, four-pixel-aligned brand width; otherwise the toolbar-alignment test legitimately fails.

## Automated test architecture

- After pulling UI changes, inspect the current accessible names before writing a smoke check; the assistant trigger was renamed from `AI assistant` to `Open AI assistant` and the stale selector produced a false failure.
- A transcription mock that emits a completed segment before `input_audio_buffer.commit` can make a broken VAD pipeline look healthy. Drive synthetic speech and silence through the real worklet and only complete on commit; test the final stop flush separately.
- Microphone stop must release tracks immediately, then await the worklet's buffered tail before committing; the main-thread PCM buffer alone does not include samples still inside the worklet. Report a failed flush rather than silently dropping the final segment.
- A persisted API write can precede its WebSocket-driven browser render. Wait for the new note's DOM element before double-clicking; polling the database alone left the full browser suite flaky.
- A test-owned browser server left running after an interrupted full suite occupied its fixture ports. Stop the orphaned fixture and use Playwright's managed webServer lifecycle with a sufficient global timeout.
- Use exact accessible-name matching when labels overlap: `API key` also matches `Remove current API key` in Playwright and causes a strict-mode failure.
- A WebSocket broadcast is sent before the HTTP response body is read. Attach the next-message listener before issuing the mutation, or the assertion waits for a message that was already delivered.
- Rejecting a foreign WebSocket origin must assert the 403 handshake and treat `open` as a failure. `terminate()` after a failed handshake emits a late error, so absorb it with a long-lived error listener before cleanup.
- Absence assertions need a lifecycle, not a sleep: count browser `POST /api/operations` requests for cancelled gestures, and use a following successful mutation as a message barrier to prove a rejected batch did not broadcast.
- Reseeding a board with the same shape count cannot be awaited by count alone; wait for the returned revision and for new ids to appear and old ids to disappear.
- Node tests that wait on child processes, sockets or daemon startup need bounded waits and cleanup that starts before the first `await`. `daemon.close()` does not force-terminate subscriber sockets.
- Node fetch refuses forbidden ports (for example port 1) before opening a socket. Use an allocated, then closed, ephemeral port to test a real connection refusal.
- For oversized request bodies, drain instead of destroying the socket so the client receives the explicit 413 and the board stays unchanged.
- Pure logic and store tests stay the fast baseline; HTTP, CLI and browser layers exist to catch wiring and contract regressions, so success assertions must check persisted values, not only status codes.

## Frame containers, HTML cards and membership

- A foreignObject captures pointer events across its whole box, not just the visible HTML child. Measure the `.card-pill` width and drive a transparent SVG hit rect from it; keep the foreignObject at `pointer-events: none`. Tests must click `.card-pill`, not the handle group bounding box, which still spans the foreignObject.
- Implicit pointer capture retargets double-click compatibility events to the capturing SVG. Resolve label double-clicks through the canvas `elementFromPoint` fallback and look up `[data-card-handle]`, not only `[data-shape-id]`.
- "New member needs full containment" and "existing member detaches only when fully outside" are different rules. Reusing one full-containment check silently dropped partially overlapping members that the old detach semantics kept.
- Drag membership must normalize signed line geometry before containment; creation already used `shapeBounds`, the drag path passed raw `w`/`h`.
- A group drag snapshots its shapes, so rebasing must also compare derived sets. Frame drags need a member-set check, otherwise members added concurrently stay behind holding `frameId`.
- Tightening persisted schema locally needs an explicit load migration. Retired widget shapes and now-invalid mixed frame connectors are dropped once; legacy line `text` is accepted and ignored.
- An inline editor inside the canvas must stop pointerdown propagation, otherwise the canvas prevents default and starts a marquee instead of placing the caret.
- Render the marquee after frames and content; an opaque frame background otherwise hides the selection rectangle when the drag starts inside a frame.
- Verify sandboxed HTML by asserting rendered iframe content through Playwright `frameLocator`, and confirm a board update re-renders markup without reloading on a related geometry move.

## Frames, typography and widgets

- Marquee and frame dragging operate on a set of shapes, so every preview and commit must update the whole group atomically. Snapping the primary shape and applying the same delta preserves relative positions without fighting per-shape alignment.
- Rich widgets need to be exclusion zones at creation and drop time; rendering them as normal shapes would have let notes and text disappear underneath.
- Playwright cannot get a bounding box from SVG groups that only contain foreignObject reliably; convert world coordinates through the canvas transform instead.
- Scripted string replacements silently no-op after formatting changes; search for the inserted marker before assuming the edit applied.

## Freehand brush

- A delegated brush-geometry worker stalled on an edge-case interpretation instead of shipping. Interrupt early when an agent debates its own tests, and take over a small pure module directly.
- Freehand paths are painted, not filled rectangles: clicking the empty centre of a path's bounding box correctly selects whatever is behind it. Tests and users must click the ink.
- A scripted insertion can silently no-op after formatting changes. Search for the inserted marker after every scripted edit.

## Four-pixel dock refinement

- Application `--space-*` tokens collide with Radix Themes' internal scale. Nest a Radix Theme for Settings controls instead of overriding the input height inside a shorter field.
- Resizing a canvas inside its own ResizeObserver callback can trigger a loop. Observe the stable parent and redraw only at the calculated backing size.
- A formatting pass rewrote CSS selectors, so a later scripted replacement silently matched nothing and left the old `width: 0; min-width: 100%` rule in place. Verify scripted edits with a follow-up search instead of assuming success.
- Aligning to a four-pixel grid requires the panel height to be a multiple of four too. Replace layout borders with inset shadows so padding plus control height stays on the grid at odd viewport sizes.
- Sampling the reference image directly (quarter-scale pixel counts) is faster and more reliable than judging "lighter" by eye.

## Dock properties and snapping

- Anchoring a popover to a measured dock height raced with responsive layout changes and let the panel overlap the dock. Prefer in-flow or parent-relative anchoring over duplicated measurements.
- The visible grid and the snapping grid must share one constant. Changing the drawn hierarchy to 16px cells while snapping to 8px would have produced unexplained half-cell offsets.
- Keep SVG guide lines above shapes and use non-scaling strokes so they remain readable at every zoom.

## Blueprint grid and fixed dock

- A worker's optional visual experiment used an unbounded loop and left a temporary file in the repository, blocking lint. Bound visual probes with explicit loop limits and timeouts, keep them outside the checkout, and let the coordinator own browser acceptance. The probe was aborted and its owned temporary file removed.
- A read-only live-browser check incorrectly pinned an earlier daily-board revision while the board was still being edited. Verify that the acceptance browser sends no write requests and compare current evidence, rather than treating historical user data as an immutable fixture.
- SVG transformation matrices expose floating-point rounding even at a clamped 5% zoom. Compare world geometry with an explicit tolerance; keep screen-space frame bounds under strict equality.
- Reject invalid grid coordinates explicitly rather than hiding the grid through a catch-all fallback. Decorative SVG geometry needs no invented interactive role.

## Canvas frame and connector editing

- A gradient approximation accepted ellipse targets outside the intended screen-space snap radius. Compute the nearest ellipse boundary and test just-inside/just-outside distances at multiple zoom levels.
- Invalid pinned anchors must fail explicitly, not silently choose another anchor. Persisted endpoint identity is part of the drawing contract.
- Prefer native fieldsets for control groups. Interactive SVG endpoint handles need a narrow semantic-lint exception because HTML buttons cannot be embedded directly in an SVG group; retain keyboard access through the inspector.
- Check pixel-slot alignment at viewport dimensions that are not multiples of eight, and prevent stale pointer hover from competing with keyboard-focus tooltips.

## HTTPS development setup

- A nested selector string broke the temporary browser acceptance script after the API batch had already succeeded. Separate browser-JavaScript quoting from CSS quoting, inspect persisted revision and IDs before retrying, and resume with non-destructive updates instead of replaying creates.
- Fetch does not reliably forward an overridden Host header. Validate against the server's actual listening port so ephemeral-port tests exercise the real HTTP contract instead of a synthetic `:0` host.
- Exact replacements must include enough surrounding context to distinguish repeated test headers; batch edits only after checking uniqueness.
- Tool paths in skills can lag the machine. Use the installed `openssl` when the documented keg path is absent, and inspect only relevant process metadata during browser discovery.

## MVP integration

- The frontend and daemon initially disagreed about signed line dimensions. Define edge-case contracts explicitly and test both directions before integration.
- A delegated daemon check briefly launched a server in the background. Include the project's Herdr dev-server rule explicitly in delegation prompts and use the designated dev-server tab for interactive services.
- Waiting for a repeated log message matched an earlier server start. Check the live process or endpoint after a restart rather than treating historical output as proof.
- A browser race test intercepted the CORS preflight instead of the write response. Filter intercepted requests by method before drawing conclusions about concurrent writes.
- A drag-feedback fix removed the existing revision guard. Keep concurrency protections explicit in delegated changes and re-test Agent/UI conflicts after interaction updates.
