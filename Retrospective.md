# Retrospective

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
