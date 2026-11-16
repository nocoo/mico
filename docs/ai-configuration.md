# AI configuration

`src/server/aiConfig.ts` owns provider configuration. Hosting, user login, AI authentication and provider availability are separate concerns. See [deployment](deployment.md) for the public origin and optional Entra login; the login App ID is **not** the managed identity used for inference.

## Authentication modes

| Setting                               | Behavior                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MICO_AI_AUTH_MODE=api-key` (default) | Local Chat uses the configured OpenAI-compatible gateway and optional Bearer key. MAI uses its API-key header.                                                                     |
| `MICO_AI_AUTH_MODE=managed-identity`  | Chat and MAI acquire Bearer tokens through `@azure/identity`'s `ManagedIdentityCredential`, explicitly selecting `AZURE_CLIENT_ID`. No API-key or Azure CLI fallback is attempted. |
| `MICO_AI_ENABLED=false`               | Disable Chat, voice and generated-image entrypoints without disabling manual drawing or image uploads. No Chat endpoint/model or identity is required.                             |
| `MICO_MOSS_ENABLED=false`             | Disable MOSS HTTP/tools and WebSocket upgrades, and prevent its UI from mounting or selecting the provider. Live defaults to MAI. Global AI disable always wins.                   |

Managed Chat uses `@ai-sdk/azure`'s Responses model (`/openai/v1/responses`) and native token-provider callback. Local API-key gateways retain Chat Completions. The verified reasoning-capable model accepts basic Chat Completions but rejects its reasoning-plus-tools combination there, so an `OK` text probe is not sufficient acceptance. Responses requests set `store=false`; the SDK preserves tool-call continuation and reasoning metadata without retaining responses server-side.

Managed identity uses the SDK's bearer-token provider cache and expiry refresh. Chat and MAI share the `https://ai.azure.com/.default` audience for the Foundry endpoints used by this integration. Tokens stay server-side and are acquired at request/connection time, never serialized into Settings or passed to the browser. Azure AI host validation and redirect rejection prevent credentials from being redirected to another service. Cancelled Chat requests do not start provider traffic after token retrieval finishes.

The MAI Realtime documentation includes examples using the Cognitive Services audience. The verified Foundry integration rejected that audience with `PermissionDenied` while the AI audience successfully transcribed the same synthetic audio using the same identity and resource. This implementation uses the verified audience directly; it does not retry with alternate credentials or audiences.

## Sources and precedence

- `MICO_RUNTIME=laptop` retains optional local `.env` loading; process variables take precedence. In API-key mode, saved `~/.config/mico/settings.json` values override Chat defaults.
- `MICO_RUNTIME=deploy` uses only process environment configuration, ignoring local environment/settings files. Set this policy in the process environment rather than inside `.env`.
- Managed-identity Chat settings are read-only in **both** runtime modes and never read or write saved keys. Endpoint and model must be explicit even in laptop mode; the local gateway defaults are not valid managed-identity destinations.
- Ordinary local settings remain owner-only (`0600`). Their stored fields are `baseURL`, `model` and `apiKey`; authentication policy belongs to the environment, not the saved file.

## Environment contract

| Variable                                             | Meaning                                                                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MICO_RUNTIME`                                       | `laptop` or `deploy`; defaults to laptop, independently of `NODE_ENV`.                                                                                                            |
| `MICO_AI_ENABLED`                                    | `true` by default in the app. The Azure adapter defaults to a provider-free preview unless explicitly enabled.                                                                    |
| `MICO_AI_AUTH_MODE`                                  | `api-key` or `managed-identity`; unknown values fail startup.                                                                                                                     |
| `AZURE_CLIENT_ID`                                    | User-assigned managed identity client ID; required for enabled managed AI. Do not use the user-login App ID or the Foundry resource's own identity.                               |
| `MAGPIE_BASE_URL`                                    | Chat base including the full API prefix, typically `/openai/v1` for Foundry. Local API-key default: `http://127.0.0.1:3425/v1`.                                                   |
| `MAGPIE_MODEL`                                       | Chat deployment name. Local API-key default: `auto/gpt-6-luna`.                                                                                                                   |
| `MAGPIE_API_KEY`                                     | API-key-mode Chat Bearer value; local default `magpie`. Empty omits authorization. Ignored by managed Chat.                                                                       |
| `MAGPIE_LECTURE_REASONING`                           | Lecture/summary reasoning effort; app default `none`. Ordinary Chat uses `low`. The verified GPT 6.1 sol deployment requires `low` or higher, so its operator profile sets `low`. |
| `AZURE_MAI_HOST`                                     | MAI resource hostname only, with no scheme, port or path.                                                                                                                         |
| `AZURE_OPENAI_DEPLOYMENT`                            | MAI streaming deployment name sent in `session.audio.input.transcription.model`.                                                                                                  |
| `AZURE_OPENAI_API_KEY`                               | MAI key in API-key mode, also used by the separate image provider. Managed MAI ignores it.                                                                                        |
| `MICO_MOSS_ENABLED`                                  | App default true while AI is enabled. The Azure adapter explicitly disables MOSS.                                                                                                 |
| `MOSS_REALTIME_URL` / `MOSS_API_KEY`                 | Local MOSS configuration, read only when MOSS is enabled.                                                                                                                         |
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_IMAGE_MODEL` | Existing API-key image-generation configuration. Image generation is not part of this managed Chat/MAI deployment.                                                                |

Managed Chat/MAI endpoints must use HTTPS Azure AI resource hosts. Chat URLs preserve the configured prefix and reject credentials, query strings and fragments; MAI accepts only a host. No resource-root URL is silently rewritten to add an API prefix. Actual resource names, hosts, tenant IDs, model deployment names and identity IDs belong in ignored/private operator configuration, not committed examples.

The local Compose gateway override remains `MICO_DOCKER_MAGPIE_BASE_URL`, defaulting to `host.docker.internal`. It is a local convenience, not a cloud endpoint.

## MAI streaming lifecycle

The daemon and Vite adapter reuse `createMaiProxy`. The browser connects to the same-origin `/mai/realtime`; the server obtains the inference token and opens `/mai/v1/realtime?intent=transcription` on the configured resource. Early `session.update` and audio messages are queued while authentication/connection completes. Frame/backlog limits and backpressure bound memory; closing or expiring the browser session prevents a late credential result from opening an upstream connection. Provider credentials are not included in browser errors or configuration.

The existing client uses mono PCM16 at 16 kHz, waits for `session.updated`, emits partial transcripts and explicitly commits at pauses/end. MOSS is not used as a fallback. The streaming model is a distinct deployment from non-streaming MAI Transcribe: inspect regional model availability and quota before provisioning. Choose a region whose catalog lists the streaming deployment; the application/container region need not match the inference region.

## Azure permissions

The attached Container App identity needs inference access **only at the selected Foundry account scope**. `Cognitive Services OpenAI User` covers OpenAI actions but does not include the registered `MAI/realtime` action; the combined integration uses `Cognitive Services User` on that one account. Do not grant subscription-wide access, create an ACR admin credential, enable local key authentication or introduce a Key Vault/client secret for this flow. Retain the identity's separate registry-scoped `AcrPull` permission.

Provisioning a resource/model, changing quota allocation or deleting an old account are operator actions requiring explicit authorization. The application does not provision them at startup. A resource migration must preserve unrelated RG resources and verify the replacement before deleting the old account; no automatic delete/purge path is included in deployment scripts.

## Public contracts

`GET /api/ai/settings` returns `{baseURL, model, hasApiKey, authMode, readOnly}`. Managed mode reports no API key and rejects updates with `AI_SETTINGS_READ_ONLY`. The Settings tab is omitted entirely in `MICO_RUNTIME=deploy`, including keyboard navigation and its view model, so the browser makes no Settings/model-list requests for that hidden page. Laptop mode retains the tab, including read-only Managed identity inspection. Hiding the UI does not remove the authenticated/read-only server API. `GET /api/ai/models` uses the same credential policy as Chat.

`GET /api/runtime` includes `aiEnabled`, `mossEnabled` and `aiSettingsVisible`; Settings visibility is derived from the runtime mode rather than a hostname or new deployment-specific switch. Disabled MOSS requests return `MOSS_DISABLED`; globally disabled AI retains `AI_DISABLED` precedence. User authentication and origin checks still run before protected routes. `/mai/config` returns only `{host, deployment, localPath}`.

## Verification

- L1: configuration policy, saved-key isolation, managed token caching/expiry, cancellation, header replacement and redirect rejection.
- L3: `managedIdentity.integration.test.ts` exercises real daemon Chat/model HTTP routes with synthetic credentials and mocked Responses events, including function invocation, persisted canvas writes, tool-result continuation and `store=false`, plus asynchronous MAI authentication/queue behavior. Existing auth tests cover protected upgrades and session revocation.
- L4: `managed-ai.spec.ts` checks hidden deployment Settings with no requests, visible-tab keyboard navigation, laptop read-only identity Settings, MAI default selection, disabled MOSS pointer/keyboard controls and absence of MOSS traffic. Local enabled-MOSS behavior remains covered separately.
- Opt-in real check: `node scripts/verify-managed-ai.ts --confirm-provider-usage --audio <pcm16-file>` runs in the actual managed-identity container. It starts a separate loopback-only daemon with a fresh temporary database, tests Chat tools, MAI transcription, lecture handling and MOSS denial, then removes only its own database. Inputs are limited to 20 seconds of 16 kHz mono PCM16. Use a complete, self-contained utterance with visualizable facts: an arbitrary mid-sentence cut can legitimately return `WAIT` in lecture mode and fail the required new-note assertion. It never changes the production daemon's authentication or board.

Automated suites use mocks, never paid providers or the daily board. The opt-in check incurs provider usage and requires explicit authorization. Keep its transcripts, deployment metadata and model receipts outside Git.

References: [MAI Realtime protocol](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe-2-streaming-realtime), [MAI streaming regions](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe-2-streaming).
