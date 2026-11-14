# Deployment

Mico has one Node.js container runtime. Hosting provider, authentication and AI availability are independent choices. Azure is the first automated cloud target; the application does not import Azure resource identifiers or provision cloud resources at startup.

## Choose a host

| Option                             | Current path                                                                          | Data and operational trade-offs                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local Docker                       | `docker compose up --build -d --wait`; [guide](docker.md)                             | Loopback only. Named volumes retain SQLite and local settings.                                                                                                                                             |
| Azure Container Apps               | [Azure preview guide](deployment-azure.md), automated provision/build/deploy          | HTTPS, ACR and managed-identity image pull. The cloud preview uses ephemeral SQLite and one replica; Chat/MAI can be enabled with managed identity, while MOSS stays disabled.                             |
| VM or another container host       | Run the same image behind an HTTPS reverse proxy; set the environment below           | A local persistent disk can retain SQLite. Operator owns TLS termination, updates and backups. No Azure-specific application changes required.                                                             |
| Cloudflare in front of a container | Proxy the public hostname to an existing container host, or use a Tunnel to that host | The container still runs Node and owns SQLite. Configure its canonical HTTPS origin; prevent any unintended alternate-origin access. No Cloudflare automation or acceptance test is included yet.          |
| Cloudflare-native runtime          | Future adapter, not an available deployment command                                   | Workers/Pages cannot run this Node HTTP/WebSocket server and `node:sqlite` unchanged. Workers + Durable Objects/D1 or Cloudflare Containers require separate lifecycle/storage integration and validation. |

A successful Azure deployment does not establish support for untested providers. Do not copy Azure infrastructure settings into application code to add another host.

## Runtime contract

The image serves UI, API and WebSocket traffic on one port. The reverse proxy must preserve the configured public `Host`, support WebSocket upgrades and stream responses without buffering. Terminate TLS at the hosting edge and keep the container port inaccessible except through that edge.

| Variable                  | Meaning                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MICO_RUNTIME`            | `laptop` (default): local environment/settings sources. `deploy`: process environment only; the AI Settings tab is hidden and its API remains read-only. This does **not** select an authentication mode. |
| `MICO_HOST` / `MICO_PORT` | Bind address and port. The image defaults to `0.0.0.0:47063`.                                                                                                                                             |
| `MICO_STATIC_DIR`         | Built frontend directory; `/app/dist` in the image.                                                                                                                                                       |
| `MICO_DB_PATH`            | SQLite path; choose a writable local filesystem. The Azure preview uses `/tmp/mico/board.sqlite`.                                                                                                         |
| `MICO_PUBLIC_ORIGIN`      | Exact canonical public HTTPS origin, with no path/query/fragment. Required for Entra login. Host/Origin checks use it rather than trusting forwarded headers.                                             |
| `MICO_AUTH_MODE`          | `none` (default) or `entra`. Optional and independent of runtime/hosting provider.                                                                                                                        |
| `MICO_AI_ENABLED`         | `true` (default) or `false`. False disables AI/voice/image-generation entrypoints and removes the requirement for Chat provider configuration. Manual drawing and image uploads still work.               |
| `MICO_EPHEMERAL`          | `true` displays the temporary-data warning. Default false. This is a notice, not a persistence implementation.                                                                                            |

AI configuration is documented separately in [ai-configuration.md](ai-configuration.md). `MICO_AI_AUTH_MODE` independently selects API-key or managed-identity provider authentication; it does not alter user login. `MICO_MOSS_ENABLED=false` disables MOSS even when Chat/MAI are enabled. With AI disabled, do not supply dummy provider credentials or a laptop gateway URL.

### Authentication is optional, not implicit

`MICO_AUTH_MODE=none` is useful on loopback or a genuinely access-controlled network. A public deployment with this mode gives every reachable caller access to the shared canvas and its mutations. Merely putting a login page in front of the frontend does not protect API or WebSocket routes.

For Entra login set:

- `MICO_AUTH_MODE=entra`
- `MICO_PUBLIC_ORIGIN`
- `MICO_AUTH_TENANT_ID`: the **login application's tenant**.
- `MICO_AUTH_CLIENT_ID`: the existing or newly registered SPA application ID.
- `MICO_AUTH_ALLOWED_OBJECT_IDS`: comma-separated allowed user object IDs **in the login tenant**.

Use the browser's MSAL authorization-code flow with PKCE. Register `${MICO_PUBLIC_ORIGIN}/auth/callback` on the **Single-page application** platform, not Web or Mobile/Desktop. No client secret, implicit grant or server-side code redemption is needed. When sharing an App ID with another application, add the callback without deleting existing redirects. Shared App IDs share a token audience/trust boundary; Mico keeps its own allowed-user list and session cookies.

The resource tenant and login tenant may be different. Neither the Azure CLI default tenant nor the managed identity determines the login issuer. Keep both sets of configuration outside the repository. Do not commit deployment IDs, user IDs, resource names or the real public origin to source, examples or acceptance reports.

The Debug entry sits immediately after Canvases in the identity bar when hosted status or a signed-in user is present. The panel contains deployment/AI status and sign-out instead of separate floating badges. Signed-in users can display their Microsoft profile photo: the browser silently requests delegated `User.Read` and fetches the fixed Graph photo endpoint, without broadening the base login scopes. Tokens and photo bytes are not sent to the canvas server or stored in SQLite. Missing consent, a missing photo or a failed request leaves a styled initial/icon entry without blocking the canvas; no extra sign-in prompt opens just to load a photo. Photo object URLs are released when the session/view changes.

The service validates token signature, issuer, audience, tenant, expiry and allowed object ID. Sessions are opaque, server-side, bounded and held in memory; cookies are Secure, HttpOnly and SameSite=Lax. Restarting a preview requires signing in again. All canvas/image APIs and WebSocket upgrades are protected when login is enabled; state-changing browser requests require the configured Origin. Health and login bootstrap remain public. Invalid configuration stops startup instead of silently turning authentication off.

## Preview storage contract

The first Azure target is a **disposable preview**, not durable hosting:

- SQLite and uploaded/generated image bytes live in the replica's temporary filesystem.
- Container restarts, replacements, new revisions and platform maintenance can lose all preview data.
- One replica and `minReplicas=1` prevent neither replacement nor data loss.
- A single-revision rollout may briefly have old and new processes with different temporary databases. Do not use this deployment for important work.
- Login sessions also disappear on replacement. Rollback restores code, not data.
- Do not upload a daily/local database as part of the image.

Durable deployment is a separate change: use a local disk on a single host with verified backups, or move authoritative data to a managed database. Do not treat copying a live SQLite file to Blob or mounting it over a network filesystem as a persistence guarantee.

The application still has one shared workspace and active canvas. Authentication does not add per-user storage isolation or multi-tenant collaboration.

## Acceptance

1. `/api/live` returns the deployed version without exposing data or credentials.
2. With Entra enabled, anonymous `/` opens the sign-in flow; `/api/state`, images and WebSocket upgrades reject anonymous callers.
3. Sign-in reaches the registered SPA callback, establishes a server session and opens the canvas. Logout revokes the session.
4. Draw a note, edit it and refresh; verify WebSocket synchronization in the same live replica.
5. Open Debug beside Canvases to inspect the preview notice, AI availability, account and application version. Disabled AI must not contact providers or request the microphone. For a managed-AI profile, validate Chat and MAI only after explicit usage authorization and verify MOSS remains disabled.
6. Foreign Origin and forged/expired sessions are rejected.

Local automated tests use mock identity keys and isolated databases; they do not prove the live Entra callback is registered. Record real browser sign-in as a separate manual acceptance step.
