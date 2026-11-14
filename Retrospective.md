# Retrospective

## Managed Foundry integration

- A successful bare Chat Completions reply did not prove tool compatibility: the target reasoning model rejected tools on that endpoint during the deployed SDK check. Use the native Azure Responses provider and verify a real function invocation/continuation, not an `OK` probe alone. Keep response storage disabled and preserve the model's reasoning metadata through the SDK.
- The newest Azure provider used a newer V4 stream union (`ping`) than the pinned AI core. Select the latest provider release compatible with the existing protocol dependency and run TypeScript; do not cast away the mismatch or force dependency overrides.
- Container App configuration can report success before the new revision is ready. An early console probe selected the previous ready replica and could not find the new verification script. Require latest-ready to equal latest and verify the image digest before selecting a replica.

- The segmented control's item remained part of roving focus despite its disabled presentation. Prevent only activation keys, not Tab or arrow navigation, and test entry and exit through the disabled option. Match the real `/moss` WebSocket route when asserting zero network attempts.
- The first operator check could report success with final-only transcription and a lecture response that never wrote a note. Require partial transcription events, the requested Chat labels, and a new non-empty note with a newer board revision; test both false-green branches with isolated module doubles, not only the usage-confirmation guard.

- The streaming and non-streaming MAI models have different regional catalogs and quotas. Inspect the exact streaming model rather than treating a non-streaming quota result as proof that the realtime path is blocked. Resource-specific names, IDs, endpoints and validation receipts stay in private operator configuration.
- The published realtime sample's Cognitive Services audience was rejected by the selected Foundry endpoint, while the AI audience succeeded with the same identity/resource and synthetic audio. Verify audiences through the actual container identity, then use one tested contract instead of adding credential or audience fallback. GPT reasoning support also needed a real check: the selected model rejected `none`, so the deployment profile explicitly uses `low`.
- Azure console commands are URL parameters; a long inline script produced an IIS handshake error, not an inference failure. Use a short shell/receiver, send larger inputs over stdin with bounded pacing, and preserve console evidence without tokens. Unpaced large input was truncated by the console transport.
- Parallel UI work was committed before its backend contract and one worker used a scoped commit message. Reorder only owned, unpublished commits and verify the final tree is identical; land shared contracts first and validate staged snapshots plus exact commit messages before accepting worker completion.
- New public Settings/runtime fields require updating all real HTTP fixtures, not just the nearest unit tests. Browser geometry checks must wait for finite panel motion to finish; keep exact geometry assertions and match the actual UI copy rather than treating serialization or capitalization differences as product defects.

## Hosted bootstrap race during v0.7.0 verification

- CI run `43533325846` caught two Graph photo requests where local runs saw one. The retained trace showed two Strict Mode runtime reads followed by two session reads; both bootstrap continuations were allowed to replace identity objects and restart the avatar effect. A local probe that delayed the retired runtime response until the active photo request reproduced the duplicate session request deterministically. Cancel retired bootstrap requests and guard every asynchronous state update against its aborted signal, including already-buffered responses. Keep the one-request assertions and add the controlled ordering regression instead of adding retries or relaxing the count. The Azure rollout remained blocked behind the failed CI gate.

## Hosted identity surface

- The first cloud preview put status badges and sign-out in a separate generic overlay instead of extending the accepted glass identity surface. Functional checks proved availability but did not prove visual compliance. Place deployment controls beside the existing canvas-list entry, reuse its glass/jelly tokens, and compare the actual panel against the canvas manager at desktop/mobile sizes before accepting a new frame extension.
- A popover height based on the full viewport ignored the space below its anchor and clipped sign-out in landscape. Bound it by Radix's available-height variable, give the last control scroll margin inside rounded corners, and verify an authenticated preview at a short landscape size with real pointer input.
- The first browser run failed before tests because a manifest import lacked Node's JSON import attribute; a later assertion compared authored milliseconds with computed seconds. Follow the actual test runtime and compare normalized CSS values. Capture finite animations in their completed state so a mid-entrance screenshot is not mistaken for the final glass treatment.

## Hosted preview integration

- The first live browser probe waited for network idle and timed out even though direct login rendering succeeded. Use DOM readiness plus the actual sign-in control as acceptance criteria, preserve screenshots and pending requests on failure, and verify identity navigation separately from page loading.

- Hosted auth initially classified raw path prefixes while API routing removed empty segments and the static server decoded paths. An independent review reproduced anonymous writes and encoded static traversal. Parse and validate one request target before HTTP/WS authorization; cover repeated separators, alternate authorities, encoded separators and traversal against real persisted data.
- Voice proxies returned before registering their sockets with the session manager, so logout only closed canvas subscriptions. Register every upgraded client and test both client and mock upstream closure on logout and expiry. Mark authenticated responses `private, no-store`, including files served by middleware.
- MSAL retains a rejected redirect promise on its instance even after clearing browser cache. Recreate that instance and clear the failed callback URL before retrying; exercise the rejection/cache lifecycle, not only a stub that returns null.
- The first hosted browser run found sign-out hidden under the assistant, callback counters lost on navigation, and a provider-request matcher counting Vite source-module paths. Keep controls outside panel hit areas, persist test counters across navigation, and match endpoint paths exactly. Mock MSAL at the test module boundary instead of shipping a global production mock hook. Check existing API status and body-size contracts before writing boundary assertions.

- Initial parallel auth drafts disagreed on session POST status and timestamp units, and the frontend memoized token redemption without memoizing session registration. Fix the HTTP contract before delegation, share its types, and test the complete callback transaction under React StrictMode rather than only testing MSAL initialization.
- A dependency commit briefly collided with another process's Git index lock. Inspect ownership and retry after the lock disappears; do not delete a live lock or stage another worker's changes.
- A pane output wait matched the echoed command instead of its completion marker. Anchor the completion regex to a full result line and inspect the process/log before declaring a long-running operation finished.

## Linux CI font regressions

- A reviewer pane remained scrolled above its latest messages, and Herdr rejected the guessed `ctrl+end` key name. Check the registered agent state and read the completed reply from that agent's session when terminal output is stale; do not mistake an older visible finding for an unresolved latest review.

- Runs `43370670697`, `43379712887` and `43392182362` failed with the same action-card pixel count (`401/89080`) and tab overflow (`19px`). These were deterministic font-dependent UI defects, not timing flakes. The stock Playwright 1.64.1 Ubuntu image passed; adding the runner's `fonts-dejavu-core` reproduced both failures. Match the runner's font set as well as browser version when reproducing visual CI failures.
- The action-card reference allowed synthesized bold CJK fallback glyphs while the app inherited `font-synthesis: none`. The recovered trace PNGs localized 400 differing pixels to the three heading glyphs. Enable weight synthesis only on the card heading, assert that policy against the reference, and attach both comparison images before pixel assertions. Keep the existing 0.002 threshold.
- DejaVu Sans Bold made the assistant tabs require about 305px in a 286px slot. Widen the panel from 348px to 372px together with its reserved canvas inset, and switch to icon-only tabs at 400px. Preserve padding, full desktop labels and the zero-overflow assertion; exercise 401/400/391px as well as desktop widths rather than shrinking fonts or increasing timeouts. The first geometry update missed the empty-state, status, toolbar and minimap assertions; their expected centers also move left by 12px. Search for the old reserved width as well as the old panel width, preserve failed artifacts and update the complete dependent geometry contract before rerunning.

## AI configuration refactor

- Non-literal secret-reference assignments in the deployment example triggered the staged secret scanner, and shortening the angle-bracket placeholder did not fix the cross-line match. Document secret variables separately instead of mixing placeholder assignments into the non-secret environment example. Run the staged scan on docs before committing; do not add an allowlist.

- Existing local test fixtures inherited `MICO_RUNTIME` from the shell, so deploy mode could turn editable Settings read-only or fail startup. Inject an explicit empty environment into laptop daemon fixtures and use scratch settings paths; exercise the suite with deploy mode in the parent environment.
- Selecting laptop mode before loading `.env` was insufficient: a file could contain `MICO_RUNTIME=deploy` and switch policy after its credentials had already been imported. Reject file-driven runtime switching, and disable Vite's own implicit env loading with `envDir: false` in deploy mode. Test the actual Vite resolver as well as the application helper.

- A worker prompt was sent before Pi had registered its agent and was rejected. Wait for the actual model-status footer, not merely the echoed launch command, before delivering a task.
- Moving local `.env` loading into the daemon entrypoint also changes direct child-process tests. Run those entrypoints from a scratch working directory with an absolute script path, so fixtures cannot ingest the developer's provider credentials while testing shutdown or deploy-mode isolation.

## Docker packaging verification

- The first runtime image copied only `src/server`, `src/shared` and `src/cli`; `store.ts` imports geometry from `src/web`, so the image built successfully but the container crashed on startup. Copy the complete source tree (excluding tests) and require health plus browser acceptance against the final image, not just a successful frontend build. Static serving remains restricted to `dist`.
- Static serving initially used `sirv`; review found its unchecked range parsing could throw after response headers and mishandle zero/suffix ranges. Replace it with `serve-static`, test zero/suffix/invalid/oversized ranges, and preserve the error callback. Voice proxy early returns also needed error listeners before credential checks; long Unicode upstream errors now use a bounded generic close reason. Docker signals now drain in-flight requests before closing SQLite, with a real SIGTERM/write regression.
- Replacing the static-serving dependency while a chained browser run was still active let the first 94 tests pass but broke the next fixture startup. Finish dependency changes before starting final validation, and rerun the entire command against one stable tree. Browser screenshots must also wait for loaded Audio controls and disable entrance animation rather than treating an in-progress frame as a rendering defect.
- Updating test assertions revealed that `assert.deepEqual(errors, [])` narrows a later mutable error list to `never[]`, and Node fetch adds cache-bypass headers to conditional requests. Check the error count before later listeners and explicitly send revalidation cache headers when testing HTTP 304.
- Adding static-serving dependencies through the local npm mirror rewrote unrelated lockfile resolutions with mirror tarball URLs. Restore those existing entries, retain only the new dependency entries, and verify a frozen install plus Docker build before committing. Registry selection belongs in the build argument, not the lockfile.
- A Herdr prompt supplied `--timeout` without `--wait` and was rejected before delivery. Use the supported paired flags and inspect the pane after a bounded timeout. The proxy worker also hit an ambiguous edit anchor and a mock WebSocket timing/type assumption; anchor edits on the containing block, and wait for an explicit event rather than one event-loop turn.

## MOSS Live verification

- Real two-speaker meetings confirmed acknowledged native tool continuations but not reliable meeting capture: later provider responses failed or were never generated, leaving decisions and owners uncaptured. A recorder completing without JavaScript errors is not a successful meeting evaluation; count provider failure events and inspect actual content before publishing.
- MediaRecorder can omit silent audio packets while preserving timestamp gaps. Muxing must fill those gaps with asynchronous resampling; otherwise audio drifts ahead even when the opening sync marker matches. Verify speech alignment beyond the marker.
- A delegated audio worker again used `find`; future worker prompts must explicitly require `fd` for discovery, even when working only in temporary directories.
- The original tool-call tests stopped at the submitted result and missed the provider's acknowledgement and continuation steps. Model the complete published protocol, including duplicate summaries and multiple consecutive calls, before treating mock success as live reliability.
- Repeated the previously recorded MOSS filename guess and ambiguous test edit. Discover the file first and anchor edits on the containing test name, even when revisiting familiar code. Recheck formatting after adding the regression assertion.
- A fake audio file began playing as soon as the microphone opened, before MOSS finished connecting. The client discards pre-ready frames, so only the end of the synthetic request reached the provider and no tool call was observed. Future probes must start synthetic speech only after the session is ready; distinguish a validated connection from an unverified tool-call path.
- A 177-second synthetic geography lesson on a user-authorized new canvas confirmed all 11 tools, audio output, and one acknowledged `add_texts` call, but the call arrived near the end and produced only a title and subtitle. Several speech segments were badly misrecognized. A separate local 20-second capture produced 20.07 seconds of PCM with strong waveform correlation, so the cause of the long-session recognition and response failures remains unproven. Future long-form checks should record frame timing and transcript quality, not merely connection and tool registration.

## Quality gate

- The test scripts listed directories by hand (`src/**/*.test.ts` expands one level under `sh`), so ten server and script test files never ran in any subset and a test added under a new directory would have been skipped silently. `scripts/run-tests.ts` now discovers every `*.test.ts` and derives L1 as "all minus the declared L3 files", so a new file cannot disappear. Compare `pnpm test` with `test:unit` plus `test:integration` after adding files.
- `biome check` reported 24 warnings while `pnpm check` stayed green, so the lint slot would have been a no-op gate. Lint now runs with `--error-on-warnings`; fix warnings instead of raising the diagnostic limit.
- A literal WebSocket handshake key in `src/server/index.test.ts` tripped gitleaks' `generic-api-key` rule, which would have failed the secret slot on the first CI run. Build probe credentials at runtime instead of allowlisting test files.
- `docs/prototypes/` is lint-excluded rather than reformatted: the browser suite compares the canvas against those frozen files, so a formatter rewrite is a visual regression.
- The committed lockfile carried 191 mirror tarball URLs from earlier local installs, which pnpm 11's supply-chain policy rejected in CI while every local command stayed green. Install with `--frozen-lockfile` and keep `registry` overrides out of the lockfile; the policy is the guard that caught it.
- A browser test selected text with `Meta+A`. It passed on macOS and failed on the Linux runner with the old text still prefixed. Use `ControlOrMeta` for any keyboard chord that differs per platform.
- The first gated CI run took 7m15s against a 5-minute target, almost entirely L4 (421s), because the runner is roughly twice as slow as this workstation (186s locally). Budget browser slots from CI measurements, not local ones.

## Tool usage

- A shell fixture embedded `${...}` in a TypeScript string, triggering Biome's template-placeholder lint only at commit time. Run the exact zero-warning linter after the final test edits, including fixture strings, before staging.
- A pre-push worktree shared the main `node_modules`, but `pnpm run build` automatically relinked dependencies relative to that temporary worktree; deleting it left broken links. Run installed build binaries directly in the snapshot and test the hook without invoking pnpm.
- The global `AGENTS.md` symlink moved between sessions; using its previously resolved directory failed. Resolve the real path again before loading rules.
- Radix's segmented control renders its own indicator in addition to the selected item surface. Remove the duplicate visual layer, retain a separate forced-colors selection marker, and test keyboard focus without assuming arrow-key movement also selects an item.
- A whole-suite visual failure exceeded the strict threshold by one pixel, but the next Playwright run cleared its trace. Preserve failing screenshots and traces before reruns; freeze fixture transitions explicitly and retain comparison images on failure instead of loosening the threshold.
- An HTML-card drag probe assumed the card body was a drag handle; the documented behavior and the unchanged baseline both use the title. Compare the parent revision and documented interaction before treating a new probe as a product regression.
- An HTML card reported `elementFromPoint` as the iframe before its selected state had been painted, while actual clicks still reached the parent. Capture events in both documents, wait for the rendered selection across animation frames, and repeat real input instead of trusting DOM state alone.
- Dialog workers again used `find` and manually started a browser fixture despite the existing guidance. Include the `fd` and Playwright-managed fixture requirements directly in delegated prompts, and preserve screenshots before subsequent runs clear `test-results`.
- A tab's right-edge hit test passed before press, but scaling the button during `:active` moved its hit target away before release. Keep interactive hit geometry stable and test a held pointer down/up, not only an instantaneous click or `elementFromPoint`.
- Tab padding assertions passed even though the Settings tab overlapped the independently positioned close button. Check the tablist's total width and real edge hit target at desktop breakpoints, not only each tab's internal padding.
- Allowing a rounded panel's overflow restored outlines but made its transparent header corners intercept the canvas. Round the header hit area and test outside clicks as well as visible focus rings.
- A rounded selection card still clipped its close focus ring despite `overflow: visible`: Radix also applies `contain: paint`. Inspect the rendered pixels as well as computed overflow, and prove the visual regression test fails when the containment is restored.
- The complete browser suite still expected “Mico is listening” after a fatal Audio error even after idle-status behavior changed. Re-run the entire suite when changing shared status language, and assert the actual error phase rather than retaining stale wording.
- A minimap zoom regression probe tried to continue dragging while both pointer positions were clamped outside the overview. Move the pointer back into its projected bounds when testing resumed movement, and separately assert that zooming itself does not jump.
- During the Audio empty-state investigation, file discovery used `find` three times despite the `fd`-only rule. The prohibited commands found screenshot candidates, ancestor instruction files, and image dimensions. Recheck the global discovery rule before every shell inspection and use `fd` for paths plus `rg` for content.
- A delegated screenshot search used `find`, and a separate browser fixture was started outside Playwright's lifecycle. Use `fd` for discovery and capture inside the isolated Playwright-managed fixture so ports and temporary databases are released reliably.
- AI frame growth may extend upward as well as downward, so asserting the frame height alone misidentified a correct bottom edge as a regression. Assert world-space edges and the intended clearance, not just width or height.
- An additive AI write acknowledged an unread concurrent revision and allowed a later stale rewrite. Advance the observed revision only across the AI's own consecutive writes; verify interleaved writes before treating a green conflict test as complete.
- Adding a note label consumed body space and a transparent frame-title hitbox blocked unrelated objects. Verify previously full notes, actual hit regions and frame containment whenever adding a visual header; reserve geometry atomically rather than hiding overflow.
- An early action-card test treated overflowing content as success, and a retry could target another canvas after a switch. Check painted and persisted bounds together, pin retries to their original canvas, and exercise delayed conflicts with identical IDs on both canvases.
- A summary recovery flag outlived its failed request, so continuing a later chat error could retry the wrong task. Scope recovery to the current request and test both immediate retry and a superseding request.
- A multi-pattern `fd` invocation treated later patterns as search paths, and guessed global rule paths ignored the `AGENTS.md` symlink. Resolve that symlink first and use one explicit regex for filename discovery before opening the resulting paths.
- The first copyable HTML template inherited Bootstrap's opaque body background, hiding the card's rounded surface, and its browser test was absent from the CI subset. Verify the actual sandbox cascade on a non-white canvas, assert key visual properties, and add new browser contracts to the gated command.
- A canvas pan regression used the lower-left corner, which became an interactive minimap hit area. Keep canvas gestures outside fixed chrome rather than treating minimap navigation as a canvas-pan failure; retain the exact endpoint delta assertions. Bottom-aligning the minimap also requires reserving horizontal toolbar space, not just changing its bottom inset.
- A minimap layout effect ran before a later sibling attached the canvas ref, so measurement never started and the viewport remained a tiny dot. Visibility-only navigation tests passed. Measure after sibling refs attach, observe frame layout changes after commit rather than reading stale DOM during render, and assert viewport dimensions and actual click centering; inspect screenshots in addition to test status.
- A history shortcut test pressed Redo as soon as the board changed, before the queued request settled and enabled the control. Wait for the relevant history button's enabled state, not just the board response or another disabled button, before sending the next shortcut.
- History review found three missing cases: lost HTTP acknowledgements after a successful replay, restoration payloads larger than the ordinary 1 MiB request cap, and stacking order after every old neighbour was removed. Confirm a matching replay snapshot, retain uncertain replay state through reconnect and block new writes from replacing it, allow a bounded larger envelope only for revision-guarded atomic restoration, and fall back to the historical index rather than appending. Add regression tests for each before claiming reliable undo/redo.
- A pre-history responsive-toolbar test assumed every selected-board control was enabled. Keep visibility and bounds assertions for every control, explicitly expect empty Undo/Redo stacks to disable those two controls, and check pointer hit targets according to that disabled state. Radix deliberately removes disabled controls from pointer hit testing.
- Overview integration initially left an API snapshot untyped in a browser test, and the worker's first SVG-only keyboard target failed accessibility lint. Use the existing snapshot contract and a native focusable control; run scoped type and semantic checks before browser verification. Frame-preview ordering assertions must target block silhouettes rather than the earlier background/border SVG elements.
- A whole-repository typecheck during parallel history/minimap implementation caught the minimap worker's unfinished exports as well as a real history-union caller omission. Keep intermediate checks scoped to owned files and run integrated TypeScript only after workers commit; enumerate exhaustive operation consumers when extending the protocol.
- An external Playwright review config inherited a relative web-server command, so the runner resolved `scripts/browser-server.ts` under the temporary config directory and could not start. Set `webServer.cwd` explicitly when reusing the repository fixture from an external config; verify accessible control labels from source before writing probes.
- During the prototype comparison, `pnpm exec playwright test` again triggered automatic dependency verification against the default registry and reported tarball URL mismatches before running the installed tests. Read the registry and recorded startup constraints first; use `node_modules/.bin/playwright` or the installed Node entrypoint for read-only verification. The 16 selected browser tests passed, and the lockfile was unchanged.
- Curved connectors can extend beyond their endpoint shapes, and an arrowhead can extend beyond a constant-width hit path at high zoom. Fit must include Bézier and arrow bounds; the painted head must remain selectable independently of the line hit area.
- Changing text line height clipped older multiline and wrapped content, and normalizing custom colors erased the distinction between black and white ink. Test saved legacy shapes against their original geometry and retain exact custom stroke colors.
- Tried to prompt a worker pane after it had been closed. Query live pane IDs before delegating additional work instead of reusing stale handles.
- Rounding the iframe itself clipped existing user HTML at its corners. Keep arbitrary iframe contents rectangular and uncut; apply the reference radius to the surrounding shell instead, and test corner rendering and interaction.
- An iframe-in-SVG test intermittently reported a successful click without delivering a DOM click. Verify the outer hit target and capture actual iframe pointer/click events before asserting embedded behavior; do not replace physical input with synthetic events.
- A delegated image renderer again used one shared corner radius for both axes, undoing the earlier narrow-image fix. Preserve independently clamped horizontal and vertical radii and rerun both narrow orientations whenever replacing image geometry.
- A new selection outline initially used SVG stroke geometry, which did not match the prototype's CSS outline at fractional pixel widths. Compare selected shapes at multiple zoom levels and let the browser apply the original outline semantics.
- An SVG selection rectangle approximated CSS `outline` incorrectly: stroke centering and browser pixel rounding produced visibly different borders at different zoom levels. Render the same CSS outline in a pointer-transparent `foreignObject` and compare against the original at 100% and 200% zoom.
- An SVG marker using `context-stroke` rendered the connector arrowhead black despite a colored line. Render the head with inherited `currentColor` and compare it against the original rather than trusting the marker declaration.
- A pixel comparison accidentally included the prototype context toolbar or the application's properties panel. Hide unrelated overlays in isolated visual fixtures, while keeping interaction tests separate.
- Ran a full TypeScript check while a delegated view extraction was between edits, producing missing-prop errors from an uncommitted intermediate state. Wait for the worker's atomic commit before validating the integrated tree.
- Started an isolated screenshot test while a worker was mid-editing `App.tsx`; Vite hot-reloaded an intermediate state and the test failed for an unrelated missing import. Freeze all production edits before browser probes, even for an expected-failure baseline, and rerun after workers commit.
- A delegated canvas worker used `find` despite the machine's `fd` rule. Require `fd` and `rg` explicitly for all delegated file discovery and check worker command logs during execution.
- A dropdown keyboard test sent ArrowDown before Radix finished moving focus into the menu, so Enter selected the original item. Wait for the focused option and its next focus transition before asserting the selected value.
- A dropdown's width was styled through the trigger's open state, so Radix's closing animation lost the width rule and briefly expanded. Style the portalled content by its own persistent class and test geometry throughout the exit animation.
- An edit guessed a nonexistent `SelectField` property. Read the actual interface and anchor replacements to existing unique text before editing.
- Delegated commits used scoped or unsupported commit types despite the shared commit rules. Check each worker's exact proposed commit message before authorizing its commit; use only the listed types and unscoped format.
- Visual regression tests must distinguish a translucent gradient surface from a missing background, and screenshot color checks must account for intentional grain. Verify the actual rendered effect before changing an assertion.
- A reference screenshot test passed options to `BrowserContext.newPage`, which Playwright ignored at runtime but TypeScript rejected. Run the repository typecheck before committing browser tests and set viewport/media on the new page explicitly.
- Canvas list editing tests initially used a text-filtered row that disappeared during renaming, letting hidden assertions pass vacuously. Assert the editing row exists before checking controls and pointer hit targets.
- A delegated canvas worker ran `pnpm exec` despite an explicit prohibition and triggered the unwanted dependency precheck. Require direct `node` or `node_modules/.bin` commands in worker prompts and inspect their command logs before accepting verification; no lockfile was changed.
- A background worker committed canvas source while an isolated browser suite was starting, risking Vite hot reload during assertions. Freeze production edits before launching browser tests and rerun any suite exposed to concurrent edits.
- A Radix select menu hides the trigger from role queries while open, and mouse selection restores focus with `:focus-visible`. Test the DOM trigger directly while the menu is open and verify both pointer selection and keyboard focus rather than assuming native modality heuristics.
- Replacing toolbar CSS dropped the auto-height rule for large font previews. Inventory the old style's behavioral rules before rewriting a surface, and retain browser checks for clipped large options.
- The complete browser suite outgrew its five-minute global timeout; size the suite deadline for the actual sequential run while keeping per-test timeouts bounded.
- Opening the redesigned assistant by default exposed previously hidden interactions: fit used the full viewport, Escape treated the panel as previously engaged, portal menus could not inherit scoped tokens, and MAI captions lost scrolling. Test first-open, panel focus, portal rendering and obstructed canvas geometry alongside each frame replacement.
- Extracting the MOSS view model reversed concurrent-tool error precedence and omitted live status from the new global indicator. Compare event ordering and observable state against the original implementation, then test overlapping tool results and session cleanup.
- A test adaptation waited for an intentionally hidden status and assumed animations were disabled while asserting their names. Assert state independently of visibility, and separate reduced-motion geometry tests from animation tests.
- A reference-fragment pixel comparison included the preceding surface's shadow and a fractional screenshot crop, producing false visual differences. Isolate visual fixtures from neighboring effects and align both crops to integer pixels before judging fidelity.
- Changing the assistant's initial tab obscured `?ai=` results. When changing a default view, explicitly test alternate entry points and the view in which their results appear.
- A frame screenshot probe waited for the live connection indicator to be visible even though the newly open panel intentionally hides it. Wait for the connection attribute or attached element when visibility is not the behavior under test.
- Added `aria-label` to generic containers, then guessed `role="group"` without checking the semantic lint rule. Use supported semantic elements or visually hidden text for labels, and run accessibility lint before committing UI changes.
- Running `pnpm dev` and `pnpm daemon` triggered pnpm's automatic dependency verification against the default registry. Before running pnpm scripts, check registry and auto-install settings; use the approved mirror or skip verification when reusing installed dependencies.
- An audio demo sync marker intercepted `OfflineAudioContext` resampling rather than audible playback, shifting the muxed voice. Mark the live `AudioContext` source and verify alignment against playback progress before delivery.
- A delegated investigator mistook itself for the coordinator and sent instructions to the audio worker. State the subordinate role and prohibition on cross-pane prompts explicitly in every delegation.
- An Audio replay probe matched both the Audio and Live status elements and stopped immediately after playback was clicked. Scope locators to the Audio tabpanel and preserve failed probe evidence separately from valid rounds.
- Passed exclusions to `fd` as positional paths; use `-E` for exclusions when discovering files. Wildcard filename patterns also need `-g` rather than regex mode.
- Guessed a MOSS source filename and supplied an ambiguous edit match; discover the real file first and include a unique function header in targeted replacements.
- CSS `inset(... round 10px)` scales both corner radii together on narrow shapes, unlike SVG rectangles. Clamp the horizontal and vertical radii separately and test both narrow orientations.
- A delegated worker used recursive `find` despite the local tool rules. Use `fd` for filename discovery and keep delegated searches scoped to the repository.
- A delegated UI worker started the Vite browser fixture in the background. Use the managed Playwright webServer or a visible herdr pane, and verify fixture ports are released afterward.
- Parallel client and browser-test work disagreed on a translated error message. Freeze the user-visible error contract before writing cross-agent assertions, then run the integration test against the final implementation.
- Used `sed` unnecessarily during inspection. Read files with the designated read tool and use `rg` for searches instead.
- `herdr pane resize --current` acted on another focused workspace despite the inherited pane context. The prior layout was restored; use an explicit pane ID for resize and verify the returned workspace.

## Logo placement

- I interpreted “swap” as moving the header containers and changing a trigger, but the owner meant swapping only the artwork. Confirm the scope of ambiguous placement changes before moving controls or changing their actions.

## UI prototypes

- I reversed the requested assistant status-dot behavior: the dot belongs with the closed pen icon, not the open close icon. Confirm the intended visible state when a bug report can be read in both directions, and test both transitions.
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

- A subprocess test waited for `close` after manually disconnecting IPC; the process had exited but pipe teardown did not complete. Assert `exit` when verifying process termination and close test-owned sockets separately.
- Image-generation tests did not return or await their async fixture, so the runner could report success before asynchronous assertions completed. Always await the fixture and put cleanup in `finally`.
- A synthetic Audio test placed the next speech exactly at the silence threshold, so a single 200ms chunk could include both sides and yield one commit instead of two. Leave more than one maximum chunk of silence when a test requires two distinct commits.
- Browser fixture ports are shared across worktrees. Check their owner before starting a suite and wait for another checkout's fixture to finish; never reuse or stop it, and recheck availability immediately before starting.
- Radix Select hides the rest of the accessibility tree while its modal listbox is open. Assert canvas tool state through its stable DOM attribute before closing the menu, then assert the properties region after choosing an option.
- Playwright can scroll a partially expanded toolbar-options container and click the wrong moving swatch. Wait until its measured width reaches its target, then assert the selected swatch before drawing.
- A locator scoped through the assistant trigger's changing accessible name stops matching when the panel opens. Use its stable toggle attribute across the transition, and assert the name separately.
- Escape closes a select but also returns the canvas to the Select tool; tests that inspect several Text dropdowns should close each by choosing its current option instead.
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

- Clearing image backgrounds only after a batch left a deleted-and-recreated shape ID linked to the old frame. Cascade at the delete operation, and test explicit reassignment later in the same batch.
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
