# web

The wiki-reader dashboard: Next.js (App Router) on top of [apps/live](../live).

It lives in the repo but outside the Nest monorepo: its own `package.json`, lockfile and `tsconfig.json`, and `nest-cli.json` doesn't list it. The root `package.json` and the Nest apps' Docker image stay free of Next and React, and the two toolchains (Nest: `nodenext` + decorators, built by Rspack; Next: `bundler` resolution + JSX, built by Turbopack) don't have to share one config.

## Run it

```bash
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

The live app has to run too: `npm run start:dev -- live` in the repo root (port 3004, see `apps/live/.env.example`), next to the ingester and bursts.

## Talking to the live app

| What | Where it runs | Base URL |
|---|---|---|
| First render: `GET /stats`, `GET /bursts` | Server Components | `LIVE_URL`, read per request |
| Live updates: `GET /live` (server-sent events) | `EventSource` in a Client Component | `NEXT_PUBLIC_LIVE_URL`, inlined at build time |

The response types come from [libs/contracts](../../libs/contracts/src/index.ts):

```ts
import type { BurstEvent, LiveEdit, LiveStreamEvents, StatsSnapshot } from "@contracts";
```

Always `import type`. The file sits outside this project, so only the type checker reads it; `turbopack.root` in `next.config.ts` keeps it out of the bundle's reach on purpose.

On the stream, each event's name is a key of `LiveStreamEvents`: `source.addEventListener("edits", ...)` receives a `LiveStreamEvents["edits"]` as JSON in `event.data`.

## Cache Components

`cacheComponents` is on (the create-next-app default since 16.4). A `fetch` without `"use cache"` runs on every request, and it has to sit inside a `<Suspense>` boundary: otherwise `next build` stops with "uncached or runtime data during prerendering". Don't put `"use cache"` on calls to the live app either. A cached call runs during `next build`, and inside `docker build` there's no live app to answer it.

## Production

`output: "standalone"` and the [Dockerfile](Dockerfile), built from the repo root. In Kubernetes: [k8s/apps/web.yaml](../../k8s/apps/web.yaml).
