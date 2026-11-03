# Retrospective

## Blueprint grid and fixed dock

- A worker's optional visual experiment used an unbounded loop and left a temporary file in the repository, blocking lint. Bound visual probes with explicit loop limits and timeouts, keep them outside the checkout, and let the coordinator own browser acceptance. The probe was aborted and its owned temporary file removed.
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
