# wiki-reader

A small pipeline that reads Wikipedia's live edit stream, archives it to S3-compatible storage and detects edit bursts, using Kafka in between, and shows it all on a live dashboard.

```
Wikimedia EventStreams ──► ingester ──► Kafka: wiki.changes ──┬──► archiver ──► S3 (wiki-archive)
                              │                               │
                              │                               ├──► bursts ──► Kafka: wiki.bursts
                              │                               │                     │
                              │                               └──► api ◄────────────┘
                              │                                     │ GET /live (SSE), /bursts, /stats
                              │                                     ▼
                              │                                    web (Next.js dashboard)
                              │
                              └──► Kafka: wiki.changes.latest (compacted, resume position)
```

## Apps and libraries

NestJS monorepo ([nest-cli.json](nest-cli.json)):

| Path | What it does |
|---|---|
| [apps/ingester](apps/ingester) | Reads the [recentchange](https://stream.wikimedia.org/v2/stream/recentchange) server-sent events (SSE) stream and publishes every event to `wiki.changes`, keyed by `<wiki>:<title>`. About once a minute it saves the last event ID to the compacted topic `wiki.changes.latest`, so after a restart it resumes where it left off. |
| [apps/archiver](apps/archiver) | Consumes `wiki.changes` and writes each partition's messages to S3 as gzipped NDJSON chunks. |
| [apps/bursts](apps/bursts) | Consumes `wiki.changes` and publishes one event to `wiki.bursts` whenever a page is suddenly edited by many different people. |
| [apps/api](apps/api) | Serves both topics to the dashboard over HTTP: `GET /live` streams new edits, new bursts and rolling stats as server-sent events, `GET /bursts` and `GET /stats` return the current state. See [API](#api). |
| [libs/kafka](libs/kafka) | Kafka ports (`MessageProducer`, `MessageConsumerFactory`, `CompactedTopicReader`), a Confluent client implementation and an in-memory fake for tests. |
| [libs/storage](libs/storage) | `ObjectStorage` port, an S3 implementation (AWS SDK v3) and an in-memory fake for tests. |
| [libs/health](libs/health) | `GET /health/live` and `GET /health/ready` ([@nestjs/terminus](https://docs.nestjs.com/recipes/terminus)), used by the Kubernetes probes. Readiness equals liveness on purpose; see the comment in [health.controller.ts](libs/health/src/health.controller.ts). |
| [libs/contracts](libs/contracts) | The types of what the api returns: `LiveEdit`, `StatsSnapshot`, `LiveStreamEvents`, and `BurstEvent` from libs/kafka. Types only, since the dashboard imports them too. |

Next to it, outside the Nest monorepo:

| Path | What it does |
|---|---|
| [apps/web](apps/web) | The dashboard: Next.js on top of the api. A separate npm project, see [Web](#web). |

### How the archiver writes chunks

- Messages are buffered per partition. A chunk is written when it reaches **300 messages**, or **60 s after its first message**, whichever comes first.
- Object key: `wiki.changes/partition=<p>/<first offset, zero-padded to 20>.jsonl.gz`, gzipped (about 7x smaller), one Kafka message per line. It is a plain `.gz` file with no `Content-Encoding`, so any tool that reads `.jsonl.gz` can open it directly.
- An offset is committed only after its chunk is stored. If a write fails, the archiver reads the partition again from the chunk's first offset and retries.
- A retry starts at the same offset, so it overwrites the same key. Delivery is at-least-once, and a retry leaves no duplicate objects behind.

### Bursts

When something happens in the world, the Wikipedia article about it is edited by many different people within minutes. The bursts app looks for exactly that: **one article edited by at least `BURST_MIN_AUTHORS` distinct human users within `BURST_WINDOW_MS`**. For each burst it publishes one JSON event to `wiki.bursts`, which a later LLM consumer can summarize.

- Only human (`bot: false`) `edit` and `new` events in the article namespace (`namespace: 0`) count. The same user editing twice counts once.
- Every window decision uses the events' own time (`meta.dt`), not the wall clock, so a backlog consumed in minutes isn't mistaken for a burst.
- After a burst the page is muted for `BURST_COOLDOWN_MS` of event time, so a hot page fires once instead of on every following edit.
- Only live bursts are published. A backlog still gets read: the ingester replays from its stored position after a restart, and bursts resumes from its committed offset. Any burst whose last edit is more than `BURST_MAX_LAG_MS` behind the wall clock is counted as stale and skipped. Skipping one doesn't start a cooldown, so a page that's still hot when the backlog is consumed fires right away.
- Pages idle for a whole window (and out of cooldown) are dropped from memory every `BURST_EVICT_INTERVAL_MS`.
- Message key: `<wiki>:<title>`. The value carries `burstId` (consumers dedupe by it), `wiki`, `title`, `serverUrl`, `titleUrl`, `authors`, `users`, `editCount`, `windowStart`/`windowEnd`, the `revisions` in the window (`rev`, `oldRev`, `user`, `ts`, for fetching diffs from `serverUrl`) and `detectedAt`. The type is `BurstEvent` in [libs/kafka/src/events.ts](libs/kafka/src/events.ts).
- The consumer group `bursts` starts at the end of `wiki.changes`, not the beginning, and auto-commits: state is in memory only and starts empty after a restart.
- `wiki.bursts` is created on startup with 6 partitions.
- **Several instances work, up to the partition count of `wiki.changes` (3).** The ingester keys every event by `<wiki>:<title>`, so all edits of one page land on one partition, and its state on the one instance that owns it. More instances than partitions sit idle. Every rebalance (an instance joining or leaving) starts the moved partitions' pages with empty state, so bursts in progress on them are missed.

To check it, run `npm run start:dev -- bursts` next to the ingester, then open Kafka UI → Topics → `wiki.bursts` → Messages. A burst usually shows up within a few minutes on a busy day; set `BURST_MIN_AUTHORS=2` to see some sooner. The app logs each burst and, once a minute, how many events it saw and accepted, how many pages it tracks, and how many bursts it emitted or skipped as stale. Use those numbers to tune `BURST_MIN_AUTHORS`.

### API

The api turns the two topics into something a browser can use. Its response types are in [libs/contracts](libs/contracts/src/index.ts).

| Endpoint | Returns |
|---|---|
| `GET /live` | Server-sent events, named after the keys of `LiveStreamEvents`: `stats` right after connecting and then every 5 s, `edits` every 500 ms when there are new ones, `burst` for each new burst. `?wiki=enwiki,dewiki` and `?bots=true\|false` filter the edits. |
| `GET /bursts?limit=50` | The latest bursts, newest first; `limit` goes up to 100 |
| `GET /stats` | The same snapshot as the `stats` event |

- **Edits:** every `edit` and `new` event on `wiki.changes` (no log entries, categorization or canary events), trimmed to a `LiveEdit`. It leaves out `parsedcomment`, so the api never hands the browser HTML. Live only: the api starts at the end of the topic, like bursts.
- **Batches:** about 30 events a second reach the api, so a stream sends them every 500 ms in one array: one React state update instead of fifteen.
- **Stats:** humans and bots per minute over the last 60 minutes, the 10 busiest wikis (all edits) and the 10 busiest articles (human edits in namespace 0, as bursts counts them). An edit counts in the minute of its own time, so the ingester's replay after a restart fills in the minutes it missed. The window ends at the wall clock's current minute, so when the stream stops, the chart drops to zero instead of freezing. In memory only, see [Known issues](#known-issues).
- **Bursts:** read from the beginning of `wiki.bursts` on every start, so the list survives an api restart (as far back as the topic's retention, 7 days by default). The latest 100 are kept, each `burstId` once.
- **Fresh consumer groups on every start, never committed:** `api-edits-<host>-<random>` and `api-bursts-<host>-<random>`. This is fan-out, not shared work. Each instance serves its own browsers, so each must see every message; instances sharing a group would split the partitions between them, and every browser would get only part of the stream. Nothing resumes from these groups, so committing would only leave offsets behind. Like the ingester's `ingester-compacted-reader-*` groups, they show up in Kafka UI while the api runs.
- **CORS:** the browser opens `GET /live` itself, from the dashboard's origin, so the api allows `WEB_ORIGIN`. The dashboard's server components call the api server to server and don't need it.
- **Shutdown** ends every open stream before the HTTP server closes, so it doesn't wait for browsers to hang up. `EventSource` reconnects on its own.

To watch the raw stream without the dashboard: `curl -N localhost:3004/live`.

### Web

[apps/web](apps/web) is the dashboard: Next.js 16 (App Router, Turbopack) on top of the api. It's in this repo but outside the Nest monorepo, on purpose:

- **Its own `package.json` and lockfile.** The root `package.json` feeds the Nest apps' one Docker image, which copies all of `node_modules`. With Next and React in it, all four Nest apps would ship them.
- **Its own `tsconfig.json`, not extending the root one.** The Nest side compiles with `nodenext` and legacy decorators; Next wants `bundler` resolution and JSX.
- **Not in `nest-cli.json`.** Nest CLI builds only the projects listed there, so it never sees apps/web. The root Vitest configs, `tsconfig.spec.json` and `npm run format` skip it too.
- **Only types cross over.** apps/web maps `@contracts` to libs/contracts and imports it with `import type`, which the compiler erases. `turbopack.root` in its `next.config.ts` pins Turbopack to apps/web: a value import from outside fails to resolve instead of pulling Nest code into the bundle. Without it, Next would take the topmost lockfile's folder, the repo root, as the root, and warn about it.

The first render comes from server components calling `API_URL`; live updates come from an `EventSource` on `NEXT_PUBLIC_API_URL`. More in [apps/web/README.md](apps/web/README.md).

## Prerequisites

- Node.js and npm
- Docker with Compose

For the Kubernetes setup (kind, kubectl, Helm) see [Kubernetes](#kubernetes).

## Getting started

```bash
npm install

# 3 Kafka brokers, Kafka UI, SeaweedFS (S3), SeaweedFS admin UI
docker compose up -d

# In separate terminals
npm run start:dev -- ingester
npm run start:dev -- archiver
npm run start:dev -- bursts
npm run start:dev -- api

# The dashboard, a separate npm project: http://localhost:3000
cd apps/web && npm install && npm run dev
```

Before the first start, create the env files (they are git-ignored, see [Configuration](#configuration)):

```bash
# .env: shared by every Nest app
KAFKA_BROKERS=localhost:9092,localhost:9094,localhost:9096

# apps/ingester/.env, apps/archiver/.env, apps/bursts/.env, apps/api/.env: one port per app
PORT=3001   # 3002, 3003, 3004
```

The dashboard reads Next's own env files instead: copy [apps/web/.env.example](apps/web/.env.example) to `apps/web/.env.local`. It points at the api on port 3004.

If you ran the project when Compose still had a `postgres` service, run `docker compose up -d --remove-orphans` once to remove its container (nothing used it). The same goes for the old single `broker` service: its container can keep host port `9092` reserved, and `kafka-1` then starts without a network.

## Configuration

Each Nest app loads env files with [`@nestjs/config`](https://docs.nestjs.com/techniques/configuration): first `apps/<app>/.env`, then the shared `.env` in the repo root. A key in the app's file wins over the shared one, and a real environment variable wins over both. [.env.example](.env.example) lists the shared keys. The dashboard uses Next's env files instead (`apps/web/.env.local`).

`KAFKA_BROKERS` has no default: an app fails on startup if it's missing. List every broker. The list is only used for the first connection (the client learns the rest of the cluster from metadata), but if it names just one broker and that broker is down, the app can't start.

The other settings have local defaults that match [docker-compose.yml](docker-compose.yml):

| Variable | Used by | Purpose |
|---|---|---|
| `KAFKA_BROKERS` | ingester, archiver, bursts, api | Comma-separated broker list. Required. |
| `S3_ENDPOINT` | archiver | S3-compatible endpoint. Leave it unset to use AWS. |
| `S3_REGION` | archiver | Bucket region |
| `S3_BUCKET` | archiver | Target bucket |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | archiver | S3 credentials. The local SeaweedFS identity is defined in [seaweedfs/s3.json](seaweedfs/s3.json). |
| `S3_CREATE_BUCKET` | archiver | Set to `false` to skip creating the bucket on startup (meant for local dev only) |
| `BURST_WINDOW_MS` | bursts | Sliding window in event time (default `600000`, 10 min) |
| `BURST_MIN_AUTHORS` | bursts | Distinct human users within the window that make a burst (default `3`) |
| `BURST_COOLDOWN_MS` | bursts | How long a page stays muted after a burst, in event time (default `3600000`, 1 h) |
| `BURST_MAX_LAG_MS` | bursts | Skip bursts whose last edit is older than this by the wall clock, e.g. while catching up (default `900000`, 15 min) |
| `BURST_EVICT_INTERVAL_MS` | bursts | How often idle pages are dropped from memory (default `60000`) |
| `PORT` | ingester, archiver, bursts, api | HTTP port (default `3000`). Set a different one per app to run them side by side. |
| `WEB_ORIGIN` | api | Origins allowed to open `GET /live` from a browser, comma-separated (default `http://localhost:3000`) |
| `API_URL` | web | Where the dashboard's server components reach the api, read per request: `http://localhost:3004` locally, `http://api:3000` in Kubernetes |
| `NEXT_PUBLIC_API_URL` | web | Where the browser reaches the api. Next inlines it into the JavaScript at build time, so in Docker it's a build argument of [apps/web/Dockerfile](apps/web/Dockerfile), not a runtime setting |

The archiver reads the `S3_*` variables before the env files are loaded, so for now set them in the real environment, not in `.env` (see [Known issues](#known-issues)).

Port mappings in Compose can be overridden too: `S3_PORT`, `SEAWEEDFS_FILER_PORT`, `SEAWEEDFS_ADMIN_PORT`.

## Local services

| Service | URL | Use it to |
|---|---|---|
| Kafka | `localhost:9092`, `localhost:9094`, `localhost:9096` | Connect the apps from the host (brokers `kafka-1`, `kafka-2`, `kafka-3`) |
| Kafka UI (kafbat) | http://localhost:8080 | Browse topics and messages, and watch consumer-group lag |
| SeaweedFS S3 | http://localhost:8333 | S3 API endpoint |
| SeaweedFS filer | http://localhost:8888/buckets/wiki-archive/ | Browse archived objects in the browser |
| SeaweedFS admin | http://localhost:23646 | Manage buckets and S3 users, and see cluster status ([docker-compose.override.yml](docker-compose.override.yml)) |
| Dashboard (`npm run dev` in apps/web) | http://localhost:3000 | Watch edits, bursts and stats live |
| api | http://localhost:3004 | `curl -N localhost:3004/live` for the raw stream, `/bursts` and `/stats` for JSON |

### Inspecting the archive

Point any S3 client at the SeaweedFS endpoint, using the identity from [seaweedfs/s3.json](seaweedfs/s3.json). With the AWS CLI:

```bash
aws --endpoint-url http://localhost:8333 s3 ls s3://wiki-archive --recursive
aws --endpoint-url http://localhost:8333 s3 cp s3://wiki-archive/wiki.changes/partition=0/00000000000000000000.jsonl.gz - | gunzip
```

Or use SeaweedFS's own shell:

```bash
docker exec -it seaweedfs weed shell
> fs.ls -l /buckets/wiki-archive/wiki.changes/partition=0/
```

### Trying a storage outage

With the archiver running, run `docker stop seaweedfs`. The archiver logs failed chunks and commits nothing, and the `archiver` group's lag grows in Kafka UI. Then run `docker start seaweedfs`: the lag drains and the chunks land under the same keys.

## Kafka replication

### Setup

- **Three KRaft nodes** (`kafka-1`, `kafka-2`, `kafka-3`), each both broker and controller. Three controllers keep a quorum with one node down; with two down the cluster stops.
- **Replication factor 3 and `min.insync.replicas=2`** as broker defaults, so topics the apps create get them too. The ingester creates `wiki.changes` (3 partitions) and `wiki.changes.latest` (1 partition, compacted) on startup, and bursts creates `wiki.bursts`.
- **Retention: 7 days or 1 GiB per partition, whichever comes first** (`KAFKA_LOG_RETENTION_BYTES`, with 100 MiB segments so deletion is fine-grained). With RF 3 the stream would otherwise grow by roughly 10 GB a day in Docker's disk. `wiki.changes` keeps about a day this way, so an archiver that stays down longer loses the oldest events; `wiki.bursts` is small and keeps the full 7 days.
- **`__consumer_offsets` also has RF 3.** Committed offsets and the group coordinator live there; with RF 1 one broker failure would stall every consumer group.
- **Producer: `acks=all` and idempotence** ([producer.ts](libs/kafka/src/kafka/producer.ts)). A write is acknowledged only once every in-sync replica (ISR) has it, and at least `min.insync.replicas` of them must be in sync. Idempotence (producer ID plus a per-partition sequence number) lets the broker drop batches that a retry sends twice, and keeps order across retries.
- **Two listeners per broker.** `INTERNAL://kafka-N:29092` is for other containers (brokers, Kafka UI). `EXTERNAL://localhost:9092/9094/9096` is for apps on the host. A client asks a bootstrap broker for metadata, then connects to the addresses brokers advertise. So `EXTERNAL` must advertise `localhost`: a container name like `kafka-1` doesn't resolve on the host, and the apps fail with `Failed to resolve 'kafka-1:9092'`.

Why not `acks=1`: the leader acknowledges as soon as it has the record. If it dies before a follower copies it, a follower without the record becomes leader, and the old leader truncates its log to match when it returns. The producer got an ack, but the record is gone.

### Trying a broker failure

Run the three apps, then use the CLI inside any running broker. If you killed `kafka-1`, run the commands in `kafka-2` with `--bootstrap-server kafka-2:29092`.

```bash
# Leader, replicas and ISR per partition
docker exec kafka-1 /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka-1:29092 --describe --topic wiki.changes
# End offset per partition, to check that writes go through
docker exec kafka-1 /opt/kafka/bin/kafka-get-offsets.sh --bootstrap-server kafka-1:29092 --topic wiki.changes
# Committed offsets and lag, and the group's coordinator
docker exec kafka-1 /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka-1:29092 --describe --group archiver
docker exec kafka-1 /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka-1:29092 --describe --group archiver --state
```

**A partition leader dies.** `docker kill kafka-1` (SIGKILL, no controlled shutdown). Within seconds (`broker.session.timeout.ms`, 9 s by default) the controller fences the broker, every partition it led gets a new leader from the ISR, and the ISR shrinks to the two live brokers. Two in-sync replicas still meet `min.insync.replicas=2`, so writes go on in every partition. The apps log only connection errors to the dead broker.

**Too few in-sync replicas.** With one broker still down, raise the threshold above what's left:

```bash
docker exec kafka-2 /opt/kafka/bin/kafka-configs.sh --bootstrap-server kafka-2:29092 --alter --entity-type topics --entity-name wiki.changes --add-config min.insync.replicas=3
```

The leader rejects writes with `NOT_ENOUGH_REPLICAS`, and offsets stop growing. The error is retriable, so the producer keeps the records in its local queue and retries. The ingester keeps reading the stream, so the queue (`queue.buffering.max.messages`, 100,000 by default) fills up within a minute or two. From then on `send()` fails at once with "queue full", and the ingester logs and drops the event. Set it back with `min.insync.replicas=2`: whatever is still queued is delivered.

Kafka loses no acknowledged record here; it refuses the write instead (durability over availability). The events are lost in the ingester, which drops whatever it fails to send (see [Known issues](#known-issues)).

**The broker comes back.** `docker start kafka-1`. It catches up and rejoins the ISR, but stays a follower: the leaders that took over keep their partitions, so leadership is unbalanced. The controller checks every 5 minutes and moves leaders back once a broker's imbalance is above 10% (`auto.leader.rebalance.enable`). To do it right away:

```bash
docker exec kafka-1 /opt/kafka/bin/kafka-leader-election.sh --bootstrap-server kafka-1:29092 --election-type PREFERRED --all-topic-partitions
```

The preferred leader is the first broker in a partition's `Replicas` list.

**A group coordinator dies.** A group's coordinator is the leader of its `__consumer_offsets` partition (`hash(groupId) % 50`). Find it with `--state` above and kill that broker. The partition gets a new leader from the ISR, and that broker becomes the coordinator. It holds every committed offset, since the partition has RF 3. The consumer finds the new coordinator and keeps going. This is not a rebalance: the consumer keeps its member ID and partitions, and its log has no new `Received rebalance event` line. A preferred election that moves the coordinator back doesn't cause one either.

If `__consumer_offsets` had RF 1 and the coordinator's data were lost, the groups would restart without offsets and the two consumers would fail in opposite ways. The archiver (`fromBeginning: true`) would archive the whole topic again; bursts (`fromBeginning: false`) would silently skip everything between its last commit and the end of the topic.

## Kubernetes

The same pipeline and its dashboard on a local [kind](https://kind.sigs.k8s.io/) cluster: Kafka run by the [Strimzi](https://strimzi.io/) operator, SeaweedFS as S3, and the archiver autoscaled by [KEDA](https://keda.sh/) on its consumer lag. Everything lives in [k8s/](k8s), as plain manifests with comments on the non-obvious choices. It's independent of the Compose setup, and both can run at the same time.

```
kind cluster "wiki": 1 control-plane + 3 workers (Docker containers)
├── namespace strimzi   Strimzi cluster operator (Helm)
├── namespace keda      KEDA operator + metrics server (Helm)
└── namespace wiki
    ├── Kafka "wiki": 3 KRaft nodes (controller + broker), one per worker, PVC each
    ├── KafkaTopics: wiki.changes (3), wiki.changes.latest (1, compacted), wiki.bursts (6)
    ├── Kafbat UI, SeaweedFS (S3)                                      k8s/infra
    └── ingester, archiver (+ ScaledObject), bursts, api, web          k8s/apps
```

| Path | What it is |
|---|---|
| [k8s/kind-config.yaml](k8s/kind-config.yaml) | The cluster: one control-plane node and three workers, pinned node image |
| [k8s/namespace.yaml](k8s/namespace.yaml) | Namespace `wiki`, created before Strimzi (its chart sets up permissions there) |
| [k8s/infra/](k8s/infra) | Kustomization: `Kafka` + `KafkaNodePool`, `KafkaTopic`s, Kafbat UI, SeaweedFS |
| [k8s/apps/](k8s/apps) | Kustomization: ConfigMap + Secret, the five Deployments (api and web with a Service each), the archiver's `ScaledObject` |
| [Dockerfile](Dockerfile) | One image, `wiki-reader:dev`, with all four Nest apps; each Deployment runs `node dist/apps/<app>/main.js` |
| [apps/web/Dockerfile](apps/web/Dockerfile) | The dashboard's image, `wiki-web:dev`, built from the repo root |
| [k8s/up.sh](k8s/up.sh), [k8s/down.sh](k8s/down.sh) | The setup and teardown steps below, as scripts |

### Prerequisites

Versions used (pinned in the scripts and manifests):

| Tool | Version |
|---|---|
| Docker (Docker Desktop) | 29.8.0 |
| kind | 0.33.0, node image `kindest/node:v1.35.8` |
| kubectl | 1.35.4 |
| Helm | 4.3.1 |
| Strimzi chart | 1.3.0 (Kafka 4.3.1) |
| KEDA chart | 2.21.0 |

On Windows: `winget install Kubernetes.kind --version 0.33.0` and `winget install Helm.Helm --version 4.3.1`. Run the commands in Git Bash or WSL. In Git Bash, `export MSYS_NO_PATHCONV=1` first: otherwise Git Bash rewrites arguments such as `/health/live` into Windows paths before kubectl sees them. The scripts set it themselves.

The cluster needs about 6 GB of memory in Docker: three brokers at 1 GiB each, plus the operators and the apps.

### Setup

`bash k8s/up.sh` runs these steps; they're also safe to re-run one by one. From the repo root:

```bash
export MSYS_NO_PATHCONV=1   # Git Bash only

# 1. Cluster: 4 Docker containers named wiki-control-plane, wiki-worker, wiki-worker2, wiki-worker3
kind create cluster --config k8s/kind-config.yaml

# 2. Namespace, then the operators. Strimzi watches only the wiki namespace.
kubectl apply -f k8s/namespace.yaml
helm upgrade --install strimzi oci://quay.io/strimzi-helm/strimzi-kafka-operator \
  --version 1.3.0 --namespace strimzi --create-namespace --set 'watchNamespaces={wiki}' --wait
helm repo add kedacore https://kedacore.github.io/charts --force-update
helm upgrade --install keda kedacore/keda --version 2.21.0 --namespace keda --create-namespace --wait

# 3. Infrastructure, and wait until Kafka and its topics are ready (the first run pulls images: a few minutes)
kubectl apply -k k8s/infra
kubectl -n wiki wait kafka/wiki --for=condition=Ready --timeout=10m
kubectl -n wiki wait kafkatopic --all --for=condition=Ready --timeout=3m
kubectl -n wiki rollout status deploy/seaweedfs --timeout=5m
kubectl -n wiki rollout status deploy/kafbat-ui --timeout=5m

# 4. App images: build, check that the native Kafka client loads, copy them into the kind nodes
docker build -t wiki-reader:dev .
docker run --rm wiki-reader:dev node --input-type=module \
  -e "import k from '@confluentinc/kafka-javascript'; console.log('librdkafka', k.librdkafkaVersion)"
kind load docker-image wiki-reader:dev --name wiki
docker build -f apps/web/Dockerfile -t wiki-web:dev .
kind load docker-image wiki-web:dev --name wiki

# 5. Apps
kubectl apply -k k8s/apps
kubectl -n wiki rollout status deploy/ingester
kubectl -n wiki rollout status deploy/archiver
kubectl -n wiki rollout status deploy/bursts
kubectl -n wiki rollout status deploy/api
kubectl -n wiki rollout status deploy/web
```

There is no registry. `kind load` copies the image into each node, and the Deployments use `imagePullPolicy: IfNotPresent` with a non-`latest` tag, so Kubernetes uses that copy instead of trying to pull. After changing the code, rebuild, load it again and run `kubectl -n wiki rollout restart deploy/<app>`. Better still, use a new tag (`wiki-reader:dev2`) and `kubectl -n wiki set image deploy/<app> <app>=wiki-reader:dev2`, so the rollout really is a new version.

### Open the dashboard

Neither Service is exposed outside the cluster, so forward both, each in its own terminal:

```bash
kubectl -n wiki port-forward svc/web 3000:3000
kubectl -n wiki port-forward svc/api 3004:3000
```

Then open http://localhost:3000. The page comes through the first forward, and web's server components reach the api inside the cluster (`API_URL=http://api:3000`). The live stream comes through the second: the browser connects to `http://localhost:3004`, the address built into the web image (`NEXT_PUBLIC_API_URL`), and the api accepts the `http://localhost:3000` origin (`WEB_ORIGIN`). Other local ports mean changing both: `WEB_ORIGIN` in [k8s/apps/config.yaml](k8s/apps/config.yaml) plus an api restart, and a rebuild of the web image with `--build-arg NEXT_PUBLIC_API_URL=...`.

### Teardown

```bash
bash k8s/down.sh   # = kind delete cluster --name wiki: deletes every node, volume and object
```

To only empty the data (Kafka topics, messages and offsets, and the SeaweedFS archive) and keep the cluster, Strimzi, KEDA and the loaded images:

```bash
bash k8s/clean.sh  # deletes the apps, Kafka, SeaweedFS and their PVCs, then redeploys infra and apps
```

### Check that it works

```bash
kubectl -n wiki get pods -o wide
```

Everything should be `1/1 Running`. `wiki-dual-role-0/1/2` are the three brokers, one per worker (the `NODE` column). `wiki-entity-operator` runs Strimzi's Topic Operator.

The commands below run Kafka's CLI inside a broker pod. Its working directory is `/opt/kafka`, hence the relative `bin/...` paths.

```bash
# Logs: each app prints "Nest application successfully started"; the ingester then prints "Connection to server opened."
kubectl -n wiki logs deploy/ingester --tail=20

# Messages are keyed by <wiki>:<title>
kubectl -n wiki exec wiki-dual-role-0 -- bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic wiki.changes --max-messages 3 --formatter-property print.key=true --formatter-property print.value=false

# Health endpoints (what the probes call)
kubectl -n wiki exec deploy/archiver -- node -e "fetch('http://localhost:3000/health/ready').then(r => r.text()).then(console.log)"

# Archived chunks in S3, after a minute or so
kubectl -n wiki exec deploy/seaweedfs -- sh -c 'echo "fs.ls -l /buckets/wiki-archive/wiki.changes/partition=0/" | weed shell'

# Bursts: usually a few within the first half hour. The app logs "Burst on ..." for each one.
kubectl -n wiki exec wiki-dual-role-0 -- bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic wiki.bursts --from-beginning --max-messages 1 --formatter-property print.key=true
```

**Kafbat UI:** `kubectl -n wiki port-forward svc/kafbat-ui 8080:8080`, then open http://localhost:8080. If Compose's Kafbat already uses 8080, pick another local port, e.g. `18080:8080`. Under Consumers you'll see `archiver`, `bursts`, short-lived `ingester-compacted-reader-*` groups (the ingester reads its stored position with a throwaway group on every start) and the api's `api-edits-*` and `api-bursts-*` groups, new ones on every api start (see [API](#api)).

To see bursts sooner, set `BURST_MIN_AUTHORS: "2"` in [k8s/apps/config.yaml](k8s/apps/config.yaml), then run `kubectl apply -k k8s/apps` and `kubectl -n wiki rollout restart deploy/bursts`. Pods read env vars only when they start.

### Experiments

Each experiment starts from a healthy cluster. Keep a second terminal running `kubectl -n wiki get pods -o wide -w` to watch pods come and go. These two helpers show partition state and consumer lag:

```bash
topics() { kubectl -n wiki exec wiki-dual-role-0 -- bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic wiki.changes; }
group()  { kubectl -n wiki exec wiki-dual-role-0 -- bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group archiver "$@"; }
```

(If you delete `wiki-dual-role-0` itself, run them against another broker pod.)

#### 1. Delete a broker pod

```bash
topics                                   # note Leader and Isr per partition
kubectl -n wiki delete pod wiki-dual-role-0
topics                                   # run it from wiki-dual-role-1 while 0 is down
```

What happens:
- `kubectl delete` stops the broker gracefully. It hands its leaderships over first (controlled shutdown), so the partitions it led get a new leader at once, e.g. `Partition: 1 Leader: 1 ... Isr: 1,2`.
- The ISR shrinks to the two live brokers, which still meets `min.insync.replicas=2`, so writes go on.
- Strimzi recreates the pod within seconds, **with the same name and on the same PVC**. Brokers aren't interchangeable the way a Deployment's pods are; each has an identity (node ID 0) and its own data. Strimzi manages them with its own StrimziPodSet, which works like a StatefulSet.
- About 10 s after the pod is back, the ISR is `0,1,2` again. The broker has caught up from where its log ended, not from scratch.
- Leadership stays where it moved until the controller's preferred-leader check (every 5 min) moves it back. To do it right away: `kubectl -n wiki exec wiki-dual-role-1 -- bin/kafka-leader-election.sh --bootstrap-server localhost:9092 --election-type PREFERRED --all-topic-partitions`.

#### 2. Stop a worker node

```bash
kubectl -n wiki get pods -o wide | grep dual-role   # pick a node, e.g. the one running wiki-dual-role-1
docker stop wiki-worker3
kubectl get nodes -w                                # NotReady after ~40-60 s
```

What happens:
- **~40–60 s:** the node goes `NotReady`, but its pods still show `Running`. Kubernetes can't tell a dead node from a network split, so it waits.
- **~300 s:** the default `not-ready` toleration on every pod expires, and the pods are evicted. A Deployment's pod (Kafbat UI) gets a replacement on another node right away. The broker shows `Terminating` and stays that way: no kubelet is left to confirm it stopped, and Strimzi won't start a second pod with the same identity while the first might still be running.
- Meanwhile Kafka carries on with two brokers: `topics` shows an ISR of `0,2`, and writes still succeed.
- Force the old pod away to see where its replacement could go:

  ```bash
  kubectl -n wiki delete pod wiki-dual-role-1 --grace-period=0 --force
  kubectl -n wiki describe pod wiki-dual-role-1 | tail -3
  # 0/4 nodes are available: 2 node(s) didn't match PersistentVolume's node affinity, 2 node(s) had untolerated taint(s).
  ```

  It stays `Pending`.

**Why:** kind's `standard` StorageClass is [local-path-provisioner](https://github.com/rancher/local-path-provisioner). A volume is a directory on the disk of the node where the pod first ran, and its PV carries a node affinity for that node: `kubectl get pv -o wide`, or `.spec.nodeAffinity` in `kubectl get pv -o yaml`. The two healthy workers fail that check. The other two nodes are the control plane (tainted) and the stopped worker (tainted unreachable). The broker's data simply isn't reachable from anywhere else. A cloud disk could be detached and attached on another node in the same zone; a local disk can't. The pod anti-affinity would also keep it off workers that already run a broker, but the PV rules them out first.

Bring the node back with `docker start wiki-worker3`. The pending pod is scheduled there as soon as the node is `Ready`; the broker was Ready about 25 s after `docker start`, and the ISR is full again soon after.

#### 3. Scale the archiver by hand, past the partition count

KEDA owns the archiver's replica count, so pause it first. With `paused: "true"`, KEDA removes its HPA and leaves the count as it is:

```bash
kubectl -n wiki annotate scaledobject archiver autoscaling.keda.sh/paused="true" --overwrite
kubectl -n wiki get hpa                                # No resources found
kubectl -n wiki scale deploy/archiver --replicas=3
group --members                                        # 3 members, #PARTITIONS 1 each
kubectl -n wiki scale deploy/archiver --replicas=4
group --members                                        # one member has #PARTITIONS 0
```

What happens:
- Every scale step is a rebalance. Each archiver log shows `Revoke partitions` and then `Assign partitions`. With the client's default (eager) protocol, every member gives up all its partitions, even the ones it gets back.
- Revoked partitions drop their in-memory chunk buffers, so the next owner re-reads from the last commit and writes those chunks under the same keys (no duplicates in S3).
- The 4th pod logs `Assign partitions' and 0 partition(s)` and sits idle: a partition is never shared by two members of a group. Partitions are the unit of parallelism.

Unpause with `kubectl -n wiki annotate scaledobject archiver autoscaling.keda.sh/paused-`. KEDA recreates its HPA, which immediately caps the archiver at `maxReplicaCount: 3`, and scales down to 1 about 30 s later.

#### 4. KEDA: build up lag, then let it scale

Pause at 0 replicas, so nothing consumes and lag builds up (the topic grows by about 30 events/s):

```bash
kubectl -n wiki annotate scaledobject archiver autoscaling.keda.sh/paused-replicas="0" --overwrite
kubectl -n wiki get deploy archiver        # 0/0
group                                      # LAG grows; no CONSUMER-ID
```

After a few minutes, remove the annotation and watch the HPA, which KEDA feeds with the lag:

```bash
kubectl -n wiki annotate scaledobject archiver autoscaling.keda.sh/paused-replicas-
kubectl -n wiki get hpa keda-hpa-archiver -w     # TARGETS = lag per replica / lagThreshold (1k)
```

**What you'll most likely see: it stays at 1.** On unpause, KEDA first restores `minReplicaCount: 1`. That one archiver drains even a 30,000-message backlog (15 min of pause) within about 15 s, before the HPA's first check (it polls every 15 s). An archiver handles thousands of messages a second; the stream brings 30. Lag-based autoscaling only pays off when consumers are slower than producers, and this one isn't.

To see the full cycle, make the archiver slower than its input for the experiment, with a tiny CPU limit:

```bash
kubectl -n wiki set resources deploy/archiver -c archiver --requests=cpu=25m --limits=cpu=25m
kubectl -n wiki rollout status deploy/archiver
kubectl -n wiki annotate scaledobject archiver autoscaling.keda.sh/paused-replicas="0" --overwrite
# wait ~3-5 minutes, then
kubectl -n wiki annotate scaledobject archiver autoscaling.keda.sh/paused-replicas-
kubectl -n wiki get hpa keda-hpa-archiver -w
```

Observed timeline:
- **~15 s:** the HPA sees `3k/1k` and sets 3 replicas. The new pods start slowly under 25m of CPU.
- **~50 s:** all three are Ready, one partition each, and the lag drains.
- **~70 s:** back to 1. That's the HPA's scale-down stabilization window (30 s, set in the ScaledObject; the default is 300 s) after the lag fell below the threshold.

Then restore the real resources: `kubectl apply -k k8s/apps`. Re-applying doesn't reset the replica count, because the archiver Deployment has no `replicas` field; the HPA owns it.

Why `lagThreshold` is 1000 and not lower: the archiver commits only after a whole 300-message chunk is stored, so with no backlog at all its lag swings between ~100 and ~750. With a threshold of 500, KEDA would keep a second replica running for nothing.

A tempting alternative is to stop S3 (`kubectl -n wiki scale deploy/seaweedfs --replicas=0`): lag does grow and KEDA asks for 3 replicas. But the new pods crash-loop, because the archiver creates its bucket on startup and S3 is down. Only the pod that was already running stays up. Scaling on lag can't help when the bottleneck is downstream. Scale SeaweedFS back to 1, and the lag drains and the archiver drops back to 1.

#### 5. Roll out a new ingester version

```bash
kubectl -n wiki get pods -l app=ingester -w     # second terminal
kubectl -n wiki rollout restart deploy/ingester # or: set image to a new tag, see Setup
```

What happens, with `strategy: Recreate`:
- The old pod shuts down first: it shows `Completed` (exit code 0, graceful shutdown).
- Only then is the new pod created. It goes `ContainerCreating` → `Running` → `1/1`, about 3 s with no reader at all, and never two at once.
- The new pod logs `Resuming from ...` and asks the stream to replay from the position stored in `wiki.changes.latest`, so the gap isn't lost. The position is saved about once a minute, so up to a minute of events is published again; consumers see them twice (at least once).
- With the default `RollingUpdate`, the new pod would start, and become Ready, while the old one still ran. For those seconds two SSE readers would publish every event twice.

## Known issues

- **An old `wiki.changes.latest` may not be compacted.** The ingester now creates it with `cleanup.policy=compact` on startup, but creating a topic is a no-op when it already exists. If an earlier version let the broker auto-create it, it still has `cleanup.policy=delete`: after `retention.ms` (7 days by default) the stored position is deleted and the ingester starts live, without replaying what it missed. Check it, and fix it once. An empty list under `Dynamic configs` means the topic uses the broker default, `delete`. An auto-created one also has 3 partitions instead of 1, which is harmless: its single key always lands on the same one.

  ```bash
  docker exec kafka-1 /opt/kafka/bin/kafka-configs.sh --bootstrap-server kafka-1:29092 --describe --entity-type topics --entity-name wiki.changes.latest
  docker exec kafka-1 /opt/kafka/bin/kafka-configs.sh --bootstrap-server kafka-1:29092 --alter --entity-type topics --entity-name wiki.changes.latest --add-config cleanup.policy=compact
  ```
- **The ingester drops events it fails to send.** It reads the stream with no backpressure, and on a failed `send()` it logs the event and moves on. It still saves later event IDs as its position, so a restart doesn't replay the gap. Instead it should stop reading on a failed send and reconnect from the last event it stored successfully (at least once; consumers can dedupe by event ID).
- **`StorageModule` has no `forRootAsync`.** The archiver reads `S3_*` from `process.env` while modules are imported, before the env files are loaded, so values in `.env` are ignored.
- **The api's stats live in memory.** They start empty on every start, each api pod counts its own, and they count twice whatever arrives twice: after an ingester restart, up to a minute of events is published again (at least once). The live feed has the same repeats, but there each `LiveEdit` carries the event's `id`, so the dashboard can drop them.

## Tests

```bash
npm test             # unit tests (Vitest), in-memory Kafka and storage fakes, no Docker needed
npm run test:e2e     # real Kafka and SeaweedFS, run `docker compose up -d` first
npm run test:cov     # coverage
```

The fakes and the real implementations run the same contract suites, [kafka.contract.ts](libs/kafka/src/testing/kafka.contract.ts) and [storage.contract.ts](libs/storage/src/testing/storage.contract.ts): the fakes in unit tests, the real ones in e2e. So the fakes the apps' tests use behave like real Kafka and S3.
