# Spec: Deploy to Fly.io (single container, US-East)

## Objective

Get the Bun server + built frontend onto a public HTTPS URL on Fly.io, verified end-to-end from a device outside the dev network, before the hackathon deadline. De-risk deployment early so there's no 2am scramble.

Scope is a **single, manual deploy** that proves the pipeline. Rate limiting, auth, custom domain, and CI/CD are deliberately out — each is its own follow-up spec, and at least rate-limiting must land before the URL is shared publicly.

## Tech Stack

- **Fly.io** as the host — first-class WebSocket support, stateful VMs, easy secrets, fast `fly deploy` loop.
- **Docker** (multi-stage): `oven/bun` base image for both build and runtime.
- **Bun** as runtime (already the dev stack) — serves static files + handles `/ws` + `/health` in one process.
- No new dependencies. No reverse proxy. No process manager.

## Commands

- Local build sanity-check: `bun run build` (produces `dist/`)
- Local prod run: `bun server/index.ts` (after build, will serve `dist/` + `/ws`)
- First-time setup: `fly launch --no-deploy` (creates `fly.toml`, app name)
- Set secret: `fly secrets set ANTHROPIC_API_KEY=sk-ant-…`
- Deploy: `fly deploy`
- Logs: `fly logs`
- Status / scale: `fly status`, `fly scale count 1`, `fly scale memory 512`
- Roll back: `fly releases` → `fly deploy --image <prev>`

## Project Structure

```
Dockerfile               → NEW — multi-stage build
.dockerignore            → NEW — keep the image small
fly.toml                 → NEW — Fly.io app config
server/index.ts          → modified: serve static files from dist/
docs/specs/deploy-fly.md → this file
```

No changes to `src/`, `server/llm.ts`, `server/session.ts`, `server/protocol.ts`.

## Architecture

**Single container.** The Bun server handles everything on one port (default `8080` in production):

- `GET /ws` → WebSocket upgrade (unchanged)
- `GET /health` → plain "ok" (unchanged, used by Fly's health check)
- `GET /*` → static file lookup in `dist/`, with `index.html` as the fallback for paths that don't match a file (SPA-style)

Bun's `Bun.file()` is used for static serving — it streams efficiently and sets correct `Content-Type` for common types (HTML, JS, CSS, WASM, images). No Nginx, no middleware.

**Region: `iad` (Ashburn, VA, US-East).** The dominant latency in this app is the Anthropic round-trip, and Anthropic's API is US-East-centric. Co-locating with Anthropic beats co-locating with demo users; the Anthropic call dwarfs the browser↔server RTT. If Anthropic later publishes a different region story we revisit.

**Process model:** one `bun server/index.ts` process per VM. One VM. Sessions are in-memory — `fly scale count N` is currently unsafe because sessions are not shareable. Horizontal scale is a separate spec.

**VM size:** `shared-cpu-1x` with **512 MB** RAM. MediaPipe is client-side so server memory is dominated by live `Session` objects (≤ 40 turns × ~200 tokens ≈ < 10 KB per session; 50 concurrent users ≈ well under 1 MB of session data). Anthropic SDK + Bun runtime comfortably fit in 512 MB with headroom. 256 MB would probably work but doesn't leave room for spikes.

**Model:** `claude-opus-4-7` always, hardcoded in `server/llm.ts` as it is today. Not configurable — this is what the "Built with Opus" hackathon is about.

## Code Changes

### `server/index.ts`

Extend the `fetch` handler to serve static files from `./dist` on non-`/ws`, non-`/health` paths. Pseudocode of the delta:

```ts
fetch(req, srv) {
  const url = new URL(req.url);

  if (url.pathname === "/ws") { /* existing upgrade logic */ }
  if (url.pathname === "/health") return new Response("ok");

  // Static file lookup. Try exact path, then index.html fallback.
  const clean = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = Bun.file(`./dist${clean}`);
  if (await file.exists()) return new Response(file);

  // SPA-style fallback: serve index.html so client-side routing can take over.
  const index = Bun.file("./dist/index.html");
  if (await index.exists()) return new Response(index);

  return new Response("not found", { status: 404 });
}
```

Path-traversal guard: `url.pathname` is the request-path (already normalized by `URL`), and `Bun.file()` resolves relative to cwd without escaping it, so the risk is low. Still, a one-line check (`if (clean.includes("..")) return 404;`) is cheap insurance.

Listen port changes from `3001` default to `process.env.PORT ?? 8080` — Fly sets `PORT=8080` by convention.

### `Dockerfile`

Multi-stage, one final image with only what's needed to run:

```Dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "server/index.ts"]
```

Slim runtime image because we don't need build tools in production.

### `.dockerignore`

Keep the image small and fast to build:

```
node_modules
dist
.git
.claude
.playwright-mcp
docs
*.md
tests
```

`node_modules` and `dist` are regenerated in the build stage.

### `fly.toml`

Minimal config:

```toml
app = "<name-chosen-at-fly-launch>"
primary_region = "iad"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 0

[[http_service.checks]]
  method = "GET"
  path = "/health"
  interval = "15s"
  timeout = "5s"
  grace_period = "10s"

[vm]
  size = "shared-cpu-1x"
  memory = "512mb"
```

**Auto-stop is on** — when no traffic for a while, the machine suspends; next request wakes it in ~300ms. This keeps the free tier free. For demo moments we can `fly scale count 1 --min 1` to prevent sleep.

**Force HTTPS is on** — browsers won't even try `getUserMedia` without it; better to hard-fail on misconfig than discover it at demo time.

## Testing Strategy

Deployment is verified in layers. Each layer is a discrete checkpoint:

1. **Local prod-mode run.** `bun run build` then `bun server/index.ts` → open `http://localhost:8080` → confirm puppet renders, webcam prompt, brain responds. Catches static-serving bugs before we touch Fly.
2. **Local Docker build.** `docker build -t hackathon .` then `docker run -p 8080:8080 -e ANTHROPIC_API_KEY=... hackathon` → same checks. Catches Dockerfile bugs.
3. **`fly deploy` succeeds** with no errors; `fly status` shows a running machine; `fly logs` shows the server's "[server] listening on…" line.
4. **Health check green.** `curl https://<app>.fly.dev/health` returns `ok`.
5. **The real test (smoke test that matters):** open `https://<app>.fly.dev/` on a **phone**, on **cellular data**, not the dev laptop's wifi. Verify:
   - Page loads, puppet renders
   - Browser prompts for webcam, consent granted
   - Hand tracking detects a hand
   - Puppet greets you (LLM round-trip via WSS)
   - Speaking into the mic produces a transcript and the puppet responds
6. **Soak test.** Leave the app running 24 h. Come back and check: `fly logs` tail has no unexpected errors, `fly status` shows the machine still healthy, one fresh connection works end-to-end.

If any step fails, stop and diagnose before moving on.

## Boundaries

- **Always:** store secrets in `fly secrets`, never in `Dockerfile` or `fly.toml`. Verify the image doesn't contain the API key with `docker history` spot-checks.
- **Ask first:** scaling to multiple machines, multi-region, or adding a custom domain (these interact with session state and TLS policy).
- **Never:** commit `ANTHROPIC_API_KEY` or any secret; `fly deploy --detach` without watching logs for the first run; bypass Fly's TLS (we need HTTPS for the webcam); rate-share the URL publicly before the rate-limit spec lands.

## Success Criteria

1. `bun run build && bun server/index.ts` serves the built app locally on `:8080` with static files, `/ws`, and `/health` all working.
2. `docker build` + `docker run` reproduces the local behavior inside the container.
3. `fly deploy` completes; `fly status` shows `passing` health.
4. `curl https://<app>.fly.dev/health` returns `ok` over HTTPS.
5. The phone-on-cellular smoke test (step 5 above) passes end-to-end: webcam permission → hand detected → puppet speaks.
6. 24 h soak: no crashes in `fly logs`, a fresh session still works.
7. Docker image size stays under ~200 MB (bun-alpine + app + prod deps).

## Decisions (confirmed 2026-04-25)

- Deploy target: **Fly.io**, single region **`iad`** (closest to Anthropic's US-East API).
- Architecture: **single container**, Bun serves static + WS + health.
- VM: **shared-cpu-1x, 512 MB**.
- Model: **`claude-opus-4-7`**, hardcoded (hackathon requirement).
- Scope: **smoke-test quality, not production-hardening**. Rate-limiting, origin-check, and custom domain are separate specs to follow.

## Open Questions

1. **Fly.io account/org.** Do you have an existing org, or is this a fresh `fly auth signup`? Just affects which account the app lands under.
2. **App name.** `fly launch` asks for one. Pick something neutral; the puppet name is generic.
3. **Cost comfort.** Fly's free tier covers one `shared-cpu-1x/512` machine with 3 GB storage. If the app sleeps when idle, bill stays near-zero. Fine?
