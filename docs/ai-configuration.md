# AI configuration

`src/server/aiConfig.ts` is the server-only configuration boundary for Chat, MAI transcription, image generation and MOSS Live. The daemon, Vite proxy adapters and image subprocess use its typed configuration instead of reading provider variables independently.

This follows wb-beacon's explicit `laptop` / `deploy` runtime distinction. It does not infer a hosted deployment from `NODE_ENV=production`: a production image running in local Docker still defaults to laptop behavior. No Azure resource or authentication infrastructure is provisioned by this refactor.

## Sources and precedence

| Runtime                         | Startup environment                                                                                                                       | Chat settings                                                                                                           | Browser editing                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `MICO_RUNTIME=laptop` (default) | The daemon reads optional `.env`; process variables win, including an explicit empty key. Vite retains its normal local env-file loading. | `~/.config/mico/settings.json` overrides environment defaults; existing local gateway defaults remain.                  | Enabled; updates take effect on the next request and are saved with owner-only permissions. |
| `MICO_RUNTIME=deploy`           | Process environment only; the daemon and Vite do not load local env files. Set this flag in the Container App environment.                | Saved files are neither read nor written. Endpoint and model must be supplied explicitly; there is no default Chat key. | Read-only; `PUT /api/ai/settings` returns `403 AI_SETTINGS_READ_ONLY`.                      |

Set `MICO_RUNTIME=deploy` in the process environment, not in a local env file; an env file that tries to switch runtime is rejected. Vite also disables its own implicit env-file loading in deploy mode. `pnpm daemon` uses the daemon's runtime-aware loader. The standalone image script uses its process environment, as before. The daemon passes its resolved image endpoint, key and model to that subprocess. Existing saved settings files are not changed or migrated when deploy mode is selected.

The local Compose file still maps `MICO_DOCKER_MAGPIE_BASE_URL` to `MAGPIE_BASE_URL`, defaulting to `host.docker.internal`. This is a local development convenience, not an Azure gateway address. Configure `MAGPIE_BASE_URL` directly on Azure Container Apps.

## Environment contract

| Variable                   | Purpose                                                              | Default / requirement                                                 |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `MICO_RUNTIME`             | Configuration source policy                                          | `laptop` or `deploy`; other values fail startup                       |
| `MAGPIE_BASE_URL`          | OpenAI-compatible Chat API base, including its `/v1` or other prefix | Laptop: `http://127.0.0.1:3425/v1`; deploy: required                  |
| `MAGPIE_MODEL`             | Chat / canvas / summary model ID                                     | Laptop: `auto/gpt-6-luna`; deploy: required                           |
| `MAGPIE_API_KEY`           | Chat Bearer credential                                               | Laptop: `magpie`; deploy: empty. Empty means no Authorization header. |
| `MAGPIE_LECTURE_REASONING` | Reasoning effort for lecture requests                                | `none`; ordinary Chat continues to use `low`                          |
| `AZURE_MAI_HOST`           | MAI upstream host, without scheme or path                            | Empty until configured                                                |
| `AZURE_OPENAI_DEPLOYMENT`  | MAI transcription model/deployment sent in the session               | Empty until configured                                                |
| `AZURE_OPENAI_API_KEY`     | Shared MAI and image API key                                         | Empty until configured                                                |
| `AZURE_OPENAI_ENDPOINT`    | Image API base, including the complete API prefix                    | Empty until configured                                                |
| `AZURE_OPENAI_IMAGE_MODEL` | Image model/deployment                                               | `gpt-image-2.5-flare`                                                 |
| `MOSS_REALTIME_URL`        | Complete MOSS WebSocket URL, including model query                   | `wss://api.mosi.cn/v1/realtime?model=moss-live-1.0`                   |
| `MOSS_API_KEY`             | MOSS Bearer credential                                               | Empty until configured                                                |

Chat and image base URLs preserve configured path prefixes and remove trailing slashes. They reject embedded credentials, query strings, fragments and non-HTTP(S) protocols. MAI accepts a host only. MOSS requires `wss:`. Configuration errors identify the variable, not its value. Keys are never included in public settings responses; those return `{baseURL, model, hasApiKey, readOnly}`. `/mai/config` still returns only `{host, deployment, localPath}`.

An image base such as `https://resource.openai.azure.com/openai/v1` produces `/openai/v1/images/generations`. A resource-root URL is **not** silently rewritten to add `/openai/v1`; check the actual provider API prefix before deployment.

## Container Apps configuration example

Set these as runtime environment entries, not Docker build arguments:

```dotenv
MICO_RUNTIME=deploy
MAGPIE_BASE_URL=https://gateway.example/v1
MAGPIE_MODEL=your-chat-model
MAGPIE_LECTURE_REASONING=none
AZURE_MAI_HOST=your-resource.services.ai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-transcription-deployment
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/openai/v1
AZURE_OPENAI_IMAGE_MODEL=gpt-image-2.5-flare
MOSS_REALTIME_URL=wss://api.mosi.cn/v1/realtime?model=moss-live-1.0
```

Configure `MAGPIE_API_KEY`, `AZURE_OPENAI_API_KEY` and `MOSS_API_KEY` separately using Container Apps secret references. The example contains only non-secret URLs/models and runtime settings. Environment changes take effect after the process is restarted/recreated. Old Settings volumes cannot override or retain the effective cloud key after a new revision receives rotated environment credentials.

Only Chat endpoint and model are required to start deploy mode. Voice and images remain optional and retain their existing missing-configuration error behavior. An empty Chat key is supported for a gateway whose authentication is handled separately; it is not application user authentication.

## Deliberate scope

This change retains API-key/Bearer authentication. Unlike wb-beacon's Azure-specific identity path, it does not add Managed Identity, Azure CLI token acquisition, Entra login or token refresh. It also does not publish an image or change any Azure resources.

Before exposing Mico publicly, separately implement user authentication/authorization, the public Host/Origin and ingress/WebSocket policy, and durable SQLite storage with an appropriate replica policy. The current server remains a local-first, single-user service; deploy-mode configuration alone does not make it safe to expose publicly.

## Verification

- L1: `src/server/aiConfig.test.ts` checks source selection, local defaults, required deploy settings, all provider overrides, URL/header validation and secret-safe errors. `src/server/aiSettings.test.ts` checks local persistence and deploy isolation from valid, corrupt and missing settings files.
- L3: `src/server/aiConfig.integration.test.ts` checks the real entrypoint and HTTP settings/models/chat routes with isolated files and mock providers. Existing realtime and image integration tests verify configured endpoints, authentication headers and image model forwarding.
- L4: `tests/browser/assistant-dialog.spec.ts` checks disabled deployment controls, blocked programmatic submissions and absence of model-list requests. Existing settings browser tests retain the editable local contract.

No test calls a paid provider or reads the daily board.
