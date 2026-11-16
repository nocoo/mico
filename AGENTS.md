# Mico

A visual canvas workspace with three interfaces: the browser canvas (React/Vite), the HTTP/WebSocket daemon, and the `mico` agent CLI backed by `node:sqlite`. Human overview: [README.md](README.md). Testing architecture & API contracts: [docs/testing.md](docs/testing.md). Historical mistakes: [Retrospective.md](Retrospective.md).

## Invariants

- Install dependencies only with `pnpm install --frozen-lockfile` (a plain install through a local mirror rewrites `pnpm-lock.yaml`, failing supply-chain checks in CI).
- Never point automated tests at the daily board (`.mico/board.sqlite`) or daily ports. Store/API/CLI/example tests use `mkdtempSync` databases and port `0`; the Playwright fixture (`scripts/browser-server.ts`) owns `127.0.0.1:27063` with an isolated daemon and `MICO_AI_MOCK=1`.
- Never start a dev server before running Playwright; `playwright.config.ts` starts and stops its own fixture. Keep real AI gateway calls out of CI.
- Agent examples under `examples/` are executable specifications covered by `scripts/examples.test.ts`; update examples alongside API changes.
- `docs/prototypes/` contains frozen visual references compared by the browser suite and is excluded from Biome.
- Do not publish, deploy, or alter branch protection without explicit authorization.

## Commands

Run in the repository root with Node 26.13.0 and pnpm 11.6.0.

```sh
pnpm hooks:install        # point core.hooksPath to .githooks/ once per clone
pnpm check                # Biome check-only (zero warnings) + tsc --noEmit
pnpm test:unit            # L1: discovered pure-logic and store tests
pnpm test:integration     # L3: real daemon HTTP/WebSocket, CLI, examples
pnpm test:e2e             # L4: CI Playwright browser subset (Chromium)
pnpm test:browser         # L4: full Playwright suite
pnpm build                # tsc --noEmit && vite build
git diff --check
```

## Quality Slots

System1 quality definitions come from `system1-quality` (v1.3.0); CI runs in native mode via `.github/workflows/ci.yml` → `./.github/workflows/quality-slots.yml` with `nocoo/base-ci` composite actions pinned to `v2026.15` (`777bbe4f9bacab8a91d8c01974480a6ee23d28e0`). Branch protection (`main quality gate`) requires `quality / Z1: Gate`.

| Slot            | Stage                               | Command and Scope                                                                                                     | Status   |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| S1 Types        | pre-commit, pre-push, CI            | `tsc --noEmit` across `tsconfig.json`                                                                                 | enforced |
| S2 Lint         | pre-commit, pre-push, CI            | `biome check --error-on-warnings .` (zero diagnostics)                                                                | enforced |
| S3 Workflow     | CI                                  | `actionlint` + immutable 40-char SHA pin verification across `.github/workflows/*.yml`                                | enforced |
| G1 Secrets      | pre-commit (staged), CI (checkout)  | `gitleaks` redacted scan                                                                                              | enforced |
| G2 Dependencies | pre-push, CI                        | `osv-scanner scan --lockfile=pnpm-lock.yaml`                                                                          | enforced |
| B1 Build        | pre-push, CI                        | `vite build` (plus `tsc --noEmit`)                                                                                    | enforced |
| L1 Unit         | pre-commit, pre-push, CI            | `pnpm run test:unit` (all non-integration `*.test.ts` under `src/` and `scripts/`; no coverage bar enforced)          | enforced |
| L2 Runtime      | —                                   | Plain Node runtime; `node:sqlite` is exercised in L1 and L3                                                           | na       |
| L3 Integration  | pre-push, CI                        | `pnpm run test:integration` (real daemon HTTP/WebSocket, CLI, examples)                                               | enforced |
| L4 E2E          | CI (subset), local (`test:browser`) | `pnpm run test:e2e` (Chromium browser specs; ~3–7m, kept in CI)                                                       | enforced |
| P1 Package      | —                                   | Private package; nothing is published or installed downstream                                                         | na       |
| Z1 Gate         | CI                                  | `z1-gate` validator in `quality-slots.yml` requiring all `impl` slots on matching `github.sha` and `na` slots skipped | enforced |

## Local Gates

`pnpm hooks:install` points Git at `.githooks/`. Never bypass hooks with `--no-verify`.

- `pre-commit`: exports the Git index via `git checkout-index` to a temporary snapshot with `node_modules` symlinked, runs S2 lint, S1 types, and L1 unit tests, then runs G1 `gitleaks git --staged`.
- `pre-push`: inspects every pushed OID from stdin in a detached worktree, verifies the installed lockfile matches the OID, and runs B1 build, L3 integration, and G2 `osv-scanner` (deletions skipped).
