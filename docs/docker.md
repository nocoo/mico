# Local Docker deployment

Mico runs as one non-root Node.js container: the Vite production bundle, HTTP API, canvas WebSocket, MAI transcription proxy and MOSS Live proxy share port `47063`. Vite is a build dependency only. SQLite uses Node's built-in driver; no database container is needed.

## Start

Requirements: Docker Engine/Desktop and Docker Compose v2.24 or newer. Host Node.js and pnpm are not required to deploy.

```sh
docker compose up --build -d --wait
```

Open <http://127.0.0.1:47063/> or <http://localhost:47063/>. Loopback HTTP is a secure browser context for microphone access. The default port is separate from the development and browser-test ports.

```sh
docker compose ps
curl --fail http://127.0.0.1:47063/api/live
docker compose logs --tail=100 mico
docker compose exec mico node src/cli/index.ts canvas list
```

The image builds from the frozen lockfile using Node.js `26.13.0` and pnpm `12.18.0`. Package downloads default to the Microsoft npm mirror so builds work on the development machine's restricted network. To use another reachable registry:

```sh
NPM_REGISTRY=https://your-npm-mirror.example/ docker compose build
```

The runtime has a read-only root filesystem, a temporary `/tmp`, no Linux capabilities, and runs as UID `1000`. Only `127.0.0.1:47063` is published. Host/origin validation remains enabled. Mico has no user authentication: do not publish the port on a LAN or the internet. This is a local deployment, not a multi-user server.

## Data and settings

Compose creates two project-scoped named volumes:

| Volume          | Container path            | Contents                                           |
| --------------- | ------------------------- | -------------------------------------------------- |
| `mico-data`     | `/data`                   | `board.sqlite`, including canvases and image bytes |
| `mico-settings` | `/home/node/.config/mico` | `settings.json`, including the server-side AI key  |

These are independent of the host's `.mico/board.sqlite` and `~/.config/mico/settings.json`. Existing host data is not imported or modified. AI settings remain owner-only (`0600`); keys are stored in plaintext in the settings volume, not returned by the API.

Rebuilding or recreating a container retains both volumes:

```sh
docker compose up --build -d --wait
docker compose down
```

`docker compose down` stops and removes the container, retaining data. SIGTERM stops accepting connections and gives active HTTP requests up to five seconds to finish before closing SQLite. **Adding `--volumes` permanently deletes this deployment's canvases, images and saved AI settings.** Keep the same Compose project name when restarting to reuse its volumes.

## Optional AI and voice services

The default runtime is `laptop`, even inside the production image. See [AI configuration](ai-configuration.md) for the `MICO_RUNTIME=deploy` environment-only policy intended for Container Apps; saved Settings files are ignored and the Settings UI becomes read-only in that mode.

Drawing, canvas management, image uploads and local persistence work without provider credentials. Compose reads the root `.env` for interpolation and passes only the provider variables declared in `compose.yaml`. `.env`, local databases, host dependencies, test artifacts and Git history never enter the Docker build context.

Copy `.env.example` to `.env` only if a file does not already exist. Supply the actual provider settings there, then recreate the container with `docker compose up -d --wait`.

- **Chat gateway:** the container default is `http://host.docker.internal:3425/v1`, not `127.0.0.1`, which would refer to the container itself. Override it with `MICO_DOCKER_MAGPIE_BASE_URL` or **AI → Settings**. Compose deliberately does not inherit the host development `MAGPIE_BASE_URL`. `MAGPIE_MODEL`, `MAGPIE_API_KEY` and `MAGPIE_LECTURE_REASONING` are passed through. Saved UI settings take precedence over environment defaults.
- **Docker Desktop:** `host.docker.internal` reaches the host. On native Linux the gateway must listen on an interface reachable from the Docker bridge; Compose supplies the `host-gateway` mapping. Alternatively use a reachable HTTPS endpoint.
- **MAI:** set `AZURE_MAI_HOST`, `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_DEPLOYMENT`. `/mai/config` exposes only host, deployment and local route; the key remains server-side.
- **Image generation:** set `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY`; `AZURE_OPENAI_IMAGE_MODEL` overrides the model/deployment. The image-generation subprocess is included in the runtime image.
- **MOSS Live:** set `MOSS_API_KEY`; `MOSS_REALTIME_URL` overrides the complete upstream URL and model query. `/moss` adds authorization server-side. Both voice routes reject foreign origins and report missing credentials without attempting an upstream connection.

AI, generated images and voice sessions can incur provider charges. The automated Docker check does not invoke them.

## Repeatable acceptance check

With local development dependencies and Google Chrome installed, and port `47063` free:

```sh
docker compose --env-file /dev/null build
node scripts/docker-smoke.ts
```

The check creates a unique Compose project and fresh volumes, clears provider credentials, and uses the already-built `mico:local` image. It verifies:

- Container health and production page loading in real headless Chrome.
- A note created through real pointer input and an API edit received over WebSocket.
- No page exceptions or failed initial page/asset requests.
- Image upload, audio byte ranges, CLI access and host/origin restrictions.
- MAI configuration and both voice routes' missing-key responses.
- Canvas, image and AI settings retention after **container recreation**.
- Non-root execution, settings-file permissions and absence of `.env`/Vite in the runtime.

Only that check's project and volumes are removed afterward, including on failure. Screenshots and container logs are retained in the printed `mico-docker-smoke-*` directory under the OS temporary directory. It never uses the daily host board or an existing deployment. Stop an existing Docker deployment with `docker compose down` before running the check, then start it again afterward.

For source-level checks, use `pnpm check`, `pnpm test`, `pnpm test:e2e` and `pnpm build`. `src/server/production.test.ts` and `src/server/realtimeProxy.test.ts` belong to L3 integration and run without Docker or real providers.
