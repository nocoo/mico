# Mico

A visual canvas workspace with three interfaces: the browser canvas (React/Vite), the HTTP/WebSocket daemon, and the `mico` agent CLI backed by `node:sqlite`.
Docs: [README.md](README.md) · [Testing & API](docs/testing.md) · [Deployment](docs/deployment.md) · [Retrospective](Retrospective.md)

## Commands

Run from root with Node 26.13.0 and pnpm 11.6.0. Local variable names live in `.env.example`.

```sh
pnpm install --frozen-lockfile   # preserve pnpm-lock.yaml tarball URLs for CI supply-chain checks
pnpm hooks:install               # point core.hooksPath to .githooks/ once per clone
pnpm dev                         # https://mico.dev.hexly.ai -> 127.0.0.1:7063
pnpm daemon                      # HTTP/WebSocket daemon on 127.0.0.1:37063
pnpm check                       # S2 Biome (0 warnings) + S1 tsc --noEmit
pnpm test:unit                   # L1: discovered pure-logic and store tests
pnpm test:integration            # L3: real daemon HTTP/WebSocket, CLI, examples
pnpm test:e2e                    # L4: CI Playwright browser subset (Chromium)
pnpm test:browser                # L4: full Playwright suite
pnpm build                       # B1: tsc --noEmit && vite build
node scripts/container-smoke.ts  # Isolated apple/container production image smoke check
git diff --check
```

## Invariants

- Install dependencies only with `pnpm install --frozen-lockfile` (a plain install through a local mirror rewrites `pnpm-lock.yaml`, failing supply-chain checks in CI).
- Never point automated tests at `.mico/board.sqlite` or daily ports; Node suites use `mkdtempSync` DBs on port `0`, and Playwright (`scripts/browser-server.ts`) uses `127.0.0.1:27063` with `MICO_AI_MOCK=1`.
- Never start a dev server before running Playwright; `playwright.config.ts` starts and stops its own fixture. Keep real AI gateway calls out of CI.
- `MICO_RUNTIME=deploy` must come from process env (never `.env`) and keeps AI Settings read-only; invalid `MICO_AUTH_MODE` / Entra config fails closed, and deployment IDs/secrets stay out of Git.
- Agent examples under `examples/` are executable specifications covered by `scripts/examples.test.ts`; update examples alongside API changes.
- `docs/prototypes/` contains frozen visual references compared by the browser suite and is excluded from Biome.
- Container builds/deploys support `apple/container` without Docker Desktop (`MICO_CONTAINER_CLI`, `MICO_CONTAINER_DNS`, `crane` for ACR); see [Docker](docs/docker.md) and [Azure](docs/deployment-azure.md).
- Do not publish, deploy, or alter branch protection without explicit authorization.

## Quality & Local Gates

Follows `system1-quality`; CI runs in native mode via `.github/workflows/ci.yml` → `.github/workflows/quality-slots.yml` (`quality / Z1: Gate` required on `main` via `main quality gate`). All remaining slots are `enforced`; status vocabulary: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `L2 Runtime` is `N/A` (plain Node; `node:sqlite` in L1/L3), `P1 Package` is `N/A` (private), `L1 Unit` coverage bar is `planned`, and non-CI `test:browser` specs are `manual`.
- **Local hooks**: `pnpm hooks:install` points `core.hooksPath` to `.githooks/`; never bypass with `--no-verify`.
- **pre-commit**: exports staged index via `git checkout-index` (symlinked `node_modules`) to run S2 lint, S1 types, and L1 unit, then G1 `gitleaks git --staged`.
- **pre-push**: validates pushed OIDs in detached worktrees (verifying installed lockfile match), running B1 build, L3 integration, and G2 `osv-scanner` (deletions skipped).

## Resources & Isolation

| Lane          | Endpoint / State                                                                                      | Boundary                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Dev           | `https://mico.dev.hexly.ai` → `127.0.0.1:7063`, daemon `127.0.0.1:37063`, `.mico/board.sqlite`        | Daily local board; never target from automated tests                     |
| Tests         | Node: port `0` + `mkdtempSync` DB; Playwright: `127.0.0.1:27063` + isolated daemon (`MICO_AI_MOCK=1`) | Isolated fixtures only; Playwright manages its own server                |
| Container     | `127.0.0.1:47063`, isolated named volumes / temp dirs                                                 | Local Docker Compose or `container-smoke.ts`; stop daily container first |
| Cloud Preview | Azure Container Apps (ephemeral SQLite, single replica)                                               | Read-only checks unless deployment is authorized                         |

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests/hooks.
