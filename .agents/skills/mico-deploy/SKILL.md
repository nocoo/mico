---

name: mico-deploy
description: Publish or update Mico's hosted container, currently the Azure Container Apps preview. Use for deploying Mico, publishing its website, Azure preview releases, or verifying a hosted update. Covers isolated checks, external environment configuration, digest-pinned images and real acceptance; does not implicitly push Git or publish a GitHub release.
---

# Mico deployment

Resolve the repository root as `../../..` from this skill directory. Run commands from that root. Read these files before acting:

- `docs/deployment.md`: provider-neutral runtime, optional auth/AI and storage boundaries.
- `docs/deployment-azure.md`: Azure adapter, required environment and current acceptance evidence.
- `docs/testing.md`: checks, isolated fixtures and known gaps.
- `scripts/deploy-azure.ts` and `scripts/cloud/azure.ts`: actual command behavior and deployed settings.

## Scope and authorization

1. Distinguish **local preparation**, **hosted deployment**, and **GitHub release**. A request to document or prepare a release does not authorize changing Azure. An explicit deployment request authorizes the selected hosted update, not unrelated resources or Git publication.
2. Default to the existing Azure preview only when that is the user's intended target. Other container hosts can use the same runtime; Cloudflare-native deployment is not implemented. Do not invent commands or silently provision another provider.
3. The Azure adapter deliberately deploys **one replica, ephemeral SQLite and AI disabled**. Auth is independently `none` or `entra`; preserve the operator's explicit choice. Recreating the replica can erase boards/images and invalidate sessions. Surface this consequence before a first deployment or a change from durable storage.
4. Never commit actual tenant/subscription IDs, resource group/name values, App IDs, user IDs, deployment origins, access tokens or environment files. Keep operator configuration and deployment records outside the repository. Never read or package the daily `.mico/board.sqlite`.
5. Do not change Entra app registration, callbacks, consent, certificates, provider credentials or existing resource access without explicit authorization. Reusing an App ID does not authorize editing the other application's settings.
6. Commit completed logical changes atomically, stage explicit paths and do not bypass hooks. Do not push Git, create tags or publish GitHub Releases unless requested. This skill deploys the current committed application version; use the repository's versioning procedure if a version bump/release is requested, rather than inventing a second version source.

## Preflight

Inspect `git status --short`, `package.json`, the lockfile and the intended change range. Preserve unrelated work, including untracked alternative lockfiles. The project uses **pnpm**, not Bun.

Load only the operator-selected, trusted environment file. A conventional local path is:

```sh
source "${MICO_DEPLOY_ENV_FILE:-$HOME/.config/mico/deploy/azure-preview.env}"
node scripts/deploy-azure.ts plan
```

`plan` validates environment values without touching Azure. Review the intended subscription, RG, region, registry, identity, environment, app and auth mode. Do not dump the full shell environment or any tokens.

**Keep the two tenant roles separate:**

- `MICO_AZ_TENANT_ID` owns the resource subscription.
- `MICO_AUTH_TENANT_ID` owns the login SPA and determines its authority/issuer.

They may differ. Never infer one from the other or change the Azure CLI default subscription. Resource commands must carry `--subscription "$MICO_AZ_SUBSCRIPTION_ID"`. If login is expired or policy denies access, stop and request the appropriate operator login; do not log out, weaken policy, or switch credentials automatically.

For an **existing app**, inspect it read-only and compare actual auth/runtime/storage settings with the template before replacing them. Do not run `provision` on every update. For an authorized **first deployment** only:

```sh
node scripts/deploy-azure.ts provision
```

That creates the dedicated identity, registry and environment and prints the future origin/callback. With Entra enabled, the operator adds the printed `/auth/callback` URI under **Single-page application**, retaining other redirects. No client secret is needed. The current login flow requests delegated `User.Read` for an optional profile photo; failure to obtain a photo must not prevent login or drawing.

## Validate a frozen source tree

Finish source/dependency edits before final tests. Verify installed dependencies match `pnpm-lock.yaml`; install frozen dependencies through an approved temporary npm mirror when necessary. Do not rewrite the lockfile to embed mirror tarball URLs.

Run the repository's required checks. When reusing installed dependencies, avoid pnpm's automatic installation/relinking by invoking installed binaries directly:

```sh
node_modules/.bin/biome check --error-on-warnings .
node_modules/.bin/tsc --noEmit
node scripts/run-tests.ts all
PATH="$PWD/node_modules/.bin:$PATH" bash -c "$(node -p 'require("./package.json").scripts["test:e2e"]')"
node_modules/.bin/vite build
```

Also run relevant additional browser specs and the configured Gitleaks/OSV checks. Browser tests must use Playwright's managed isolated fixture, never daily ports or the live deployment. Preserve failed screenshots/traces before rerunning. For UI work, inspect actual screenshots and compare the affected surface with Mico's glass/jelly reference; a passing DOM assertion is not visual acceptance.

Authentication changes require real local HTTP/WS tests with synthetic identity keys. Browser identity mocks do not prove real Entra login. New UI must cover keyboard, responsive layout and pointer hit targets. Obtain an independent review when required by the project workflow; resolve findings in at most three bounded review rounds.

Record the checked SHA and which checks actually ran. Do not claim GitHub CI passed from local results; if a GitHub release/automatic production publication is requested, verify the required CI gates for that exact revision separately.

## Build and update Azure

Commit all intended tracked changes, then freeze the revision:

```sh
RELEASE_SHA=$(git rev-parse HEAD)
node scripts/deploy-azure.ts build
[ "$(git rev-parse HEAD)" = "$RELEASE_SHA" ] || exit 1
node scripts/deploy-azure.ts deploy
```

- `build` archives the committed SHA into its own temporary directory, builds `linux/amd64`, authenticates to ACR through Azure CLI and pushes `mico:<full-sha>`. Untracked files, local environment and the daily database are excluded.
- `deploy` resolves that SHA's image and pins its **digest**, not a mutable tag, on the selected app. It requires a clean tracked tree and updates the existing app when present.
- Long-running build/deploy commands belong in a dedicated named terminal. Wait with a bounded timeout and inspect actual logs; a command echo is not completion. Do not interrupt a shared daemon or delete another process's lock to make progress.
- Do not retry an uncertain cloud mutation blindly. Query the selected resource first, then resume only the missing step. Do not delete the RG as cleanup.

## Verify the exact deployed artifact

Derive the live origin from the resource, not a copied URL:

```sh
MICO_PUBLIC_ORIGIN="https://$(az containerapp show \
  --subscription "$MICO_AZ_SUBSCRIPTION_ID" \
  --resource-group "$MICO_AZ_RESOURCE_GROUP" --name "$MICO_AZ_APP" \
  --query properties.configuration.ingress.fqdn -o tsv)"
curl --fail "$MICO_PUBLIC_ORIGIN/api/live"
az containerapp revision list \
  --subscription "$MICO_AZ_SUBSCRIPTION_ID" \
  --resource-group "$MICO_AZ_RESOURCE_GROUP" --name "$MICO_AZ_APP" \
  --query '[].{name:name,active:properties.active,health:properties.healthState}'
```

Confirm the active ready revision's digest equals ACR's `mico:$RELEASE_SHA` digest, the replica policy is unchanged, and the health version matches `package.json`. Check runtime capabilities and auth values against the private operator configuration without recording them in Git.

Then verify:

1. Real Chrome renders the login page or canvas as appropriate, with no page exceptions or broken initial assets. Use DOM readiness and visible controls, not `networkidle` as a proxy for usability.
2. With Entra enabled, anonymous canvas/image APIs and WebSocket upgrades reject access. Sign-in navigates to the configured **login tenant**, App ID and callback using authorization code + S256 PKCE.
3. An operator completes real sign-in; mark this pending if only the login page/navigation was checked. Existing callback registration need not change for an ordinary update at the same origin.
4. Create a test note, edit it and refresh in an explicitly disposable test canvas. Verify WebSocket synchronization and sign-out. Never clear or seed the user's live board for acceptance.
5. Open Debug from the avatar/placeholder next to Canvases. Verify the preview warning, AI state, user identity and sign-out; missing photo/consent must leave a usable fallback. Preserve screenshots outside Git when they contain personal information or deployment identifiers.
6. AI remains unavailable for the preview. Do not call paid model/voice/image providers as a deployment smoke test.

A local check of the final production image should also prove manual drawing and reload without provider credentials. Keep that container's database/ports isolated and remove only its own resources afterward.

## Report and recover

Report the deployed source SHA/digest, reachable URL, actual checks, review status and remaining manual acceptance. Keep resource identifiers and deployment records in the operator's private directory, not committed acceptance reports. Distinguish user-confirmed login from automated evidence.

If the new revision is unhealthy, inspect its logs and image/env settings before changing anything. Use an explicitly approved previous digest to restore code when needed; rollback does not restore ephemeral canvas data or sessions. Never retag an old SHA or claim a database recovery from a code rollback. Do not delete resources or broaden access as an automatic fallback.
