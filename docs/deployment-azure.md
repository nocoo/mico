# Azure Container Apps preview

This is the first cloud adapter for the [provider-neutral deployment contract](deployment.md). It deploys a single disposable preview: optional authentication, no AI, no durable data. It does not create an Entra application or change its redirect URIs.

## Resources and costs

Use an existing, intentionally selected resource group. The adapter creates:

- A Basic Container Registry with admin access disabled.
- A user-assigned managed identity with `AcrPull` scoped only to that registry.
- A Container Apps environment, without a Log Analytics destination for this minimal preview.
- One Container App with external HTTPS, 0.5 CPU / 1 GiB memory, one replica and single-revision mode.

No database, storage account, Key Vault, AI resource or client secret is needed. ACR and the running replica incur Azure charges. Log streaming is available through the CLI; historical Log Analytics retention is not configured. Azure may manage additional environment infrastructure; the script does not create a second application resource group.

The preview has **no durability promise**. Replacing the replica can erase every canvas and image. `MICO_EPHEMERAL=true` makes this visible in the product. This is not a production deployment template.

## Operator configuration

Keep configuration in a private file outside the repository, such as `$HOME/.config/mico/deploy/azure-preview.env`, with owner-only permissions. Export these values before invoking scripts; no default subscription, resource group or tenant is embedded in code.

| Variable | Required value |
| --- | --- |
| `MICO_AZ_SUBSCRIPTION_ID` | Subscription that owns the existing resource group |
| `MICO_AZ_TENANT_ID` | Tenant owning that subscription; used for preflight, not login |
| `MICO_AZ_RESOURCE_GROUP` | Existing resource group name |
| `MICO_AZ_LOCATION` | Resource group location; resources are created there |
| `MICO_AZ_REGISTRY` | Globally unique lowercase alphanumeric ACR name |
| `MICO_AZ_IDENTITY` | User-assigned managed identity name |
| `MICO_AZ_ENVIRONMENT` | Container Apps environment name |
| `MICO_AZ_APP` | Container App name |
| `MICO_AUTH_MODE` | Explicitly `entra` or `none`; there is no implicit choice in the Azure adapter |
| `MICO_AUTH_TENANT_ID` | With Entra: login tenant, which may differ from the resource tenant |
| `MICO_AUTH_CLIENT_ID` | With Entra: SPA application client ID |
| `MICO_AUTH_ALLOWED_OBJECT_IDS` | With Entra: comma-separated user object IDs from the login tenant |
| `NPM_REGISTRY` | Optional reachable build registry; defaults to the Microsoft npm mirror |

Do not put real values in tracked `.env.example`, scripts or documentation. The build uses a Git archive of the committed revision, not the working directory; local environment files and untracked files never enter the image build context.

Requirements: Node.js 24+, Docker with `linux/amd64` builds, Azure CLI with Container Apps commands, and an existing Azure login. The operator needs resource-creation permissions, the ability to assign the registry-scoped role, and ACR push permission. The script never logs in or changes the CLI default subscription. Every resource command passes the configured subscription explicitly.

## First deployment

```sh
source "$HOME/.config/mico/deploy/azure-preview.env"
node scripts/deploy-azure.ts plan
node scripts/deploy-azure.ts provision
```

`plan` validates local configuration without accessing Azure. `provision` verifies the subscription's resource tenant and the resource group's location, creates missing resources and prints the canonical HTTPS origin and SPA callback. Existing resources are reused only by the configured names/types; other resource groups are not modified. Errors stop execution instead of being silently ignored.

When `MICO_AUTH_MODE=entra`, add the printed callback to the existing login application under **Authentication → Single-page application**:

```text
${MICO_PUBLIC_ORIGIN}/auth/callback
```

The actual origin is derived from the app name and Azure environment's default domain. Keep existing application redirects. Do not create a secret or change the application's tenant/platform type. The application remains protected even if the callback has not yet been registered; sign-in simply cannot finish.

After the code and tests are committed:

```sh
node scripts/deploy-azure.ts build
node scripts/deploy-azure.ts deploy
```

`build` rejects tracked uncommitted changes, exports the current Git commit to a temporary directory, builds `linux/amd64`, signs in to ACR through Azure CLI and pushes `mico:<full-git-sha>`. It removes only its own temporary directory afterward. Untracked files are not packaged.

`deploy` resolves that commit's image digest and pins it on the Container App. It configures runtime environment variables, the independent auth choice, disabled AI, ephemeral SQLite under `/tmp`, and explicit startup/liveness/readiness probes. Updates use the same command; the canonical domain stays stable while the environment and app names remain unchanged.

Do not repoint this preview adapter at an existing durable/production app: it deliberately installs a disposable configuration and does not preserve unrelated container settings. A clean dedicated resource group is the recommended first target.

## Verify

Use the printed origin as a shell variable, not a committed URL:

```sh
curl --fail "$MICO_PUBLIC_ORIGIN/api/live"
curl -i "$MICO_PUBLIC_ORIGIN/api/state"
az containerapp revision list \
  --subscription "$MICO_AZ_SUBSCRIPTION_ID" \
  --resource-group "$MICO_AZ_RESOURCE_GROUP" --name "$MICO_AZ_APP" \
  --query '[].{name:name,active:properties.active,health:properties.healthState}'
az containerapp logs show \
  --subscription "$MICO_AZ_SUBSCRIPTION_ID" \
  --resource-group "$MICO_AZ_RESOURCE_GROUP" --name "$MICO_AZ_APP" --tail 50
```

With Entra enabled, the anonymous state request must return 401. Check the login page, real Microsoft sign-in, drawing, refresh, WebSocket updates and logout in a browser. Real login is a separate manual gate; HTTP health alone is not end-to-end acceptance.

The first preview intentionally does not configure Chat, MAI, MOSS or image generation. Do not copy the host's provider credentials or local gateway URL into the app. A future AI deployment must separately establish endpoint reachability, authentication and provider billing authorization.

## Stop, update and recover

A new code deployment replaces ephemeral state. Treat that loss as expected, not as a migration. Keep exact Git SHAs/digests in operator release records outside the repository. Redeploying a previous digest can restore its code but not an earlier canvas or in-memory session.

To stop spending, explicitly remove the preview app/environment/registry/identity when no longer needed, after checking ownership and any shared use. The scripts intentionally have no resource-group deletion command and never delete data or resources automatically. Do not delete a group just because it has the same name as a sample configuration.
