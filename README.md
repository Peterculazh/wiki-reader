# wiki-reader

A small pipeline that reads Wikipedia's live edit stream, archives it to S3-compatible storage and detects edit bursts, using Kafka in between.

```
Wikimedia EventStreams ──► ingester ──► Kafka: wiki.changes ──┬──► archiver ──► S3 (wiki-archive)
                              │                               │
                              │                               └──► bursts ──► Kafka: wiki.bursts
                              │
                              └──► Kafka: wiki.changes.latest (compacted, resume position)
```

## Apps and libraries

NestJS monorepo ([nest-cli.json](nest-cli.json)):

| Path | What it does |
|---|---|
| [apps/ingester](apps/ingester) | Reads the [recentchange](https://stream.wikimedia.org/v2/stream/recentchange) server-sent events (SSE) stream and publishes every event to `wiki.changes`. About once a minute it saves the last event ID to the compacted topic `wiki.changes.latest`, so after a restart it resumes where it left off. |
| [apps/archiver](apps/archiver) | Consumes `wiki.changes` and writes each partition's messages to S3 as gzipped NDJSON chunks. |
| [apps/bursts](apps/bursts) | Consumes `wiki.changes` and publishes one event to `wiki.bursts` whenever a page is suddenly edited by many different people. |
| [libs/kafka](libs/kafka) | Kafka ports (`MessageProducer`, `MessageConsumerFactory`, `CompactedTopicReader`), a Confluent client implementation and an in-memory fake for tests. |
| [libs/storage](libs/storage) | `ObjectStorage` port, an S3 implementation (AWS SDK v3) and an in-memory fake for tests. |

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
- **Run a single instance.** `wiki.changes` is keyless, so one page's edits are spread over every partition; a second instance would split each page's state and miss bursts.

To check it, run `npm run start:dev -- bursts` next to the ingester, then open Kafka UI → Topics → `wiki.bursts` → Messages. A burst usually shows up within a few minutes on a busy day; set `BURST_MIN_AUTHORS=2` to see some sooner. The app logs each burst and, once a minute, how many events it saw and accepted, how many pages it tracks, and how many bursts it emitted or skipped as stale. Use those numbers to tune `BURST_MIN_AUTHORS`.

## Prerequisites

- Node.js and npm
- Docker with Compose

## Getting started

```bash
npm install

# Kafka, Kafka UI, Postgres, SeaweedFS (S3), SeaweedFS admin UI
docker compose up -d

# In separate terminals
npm run start:dev -- ingester
npm run start:dev -- archiver
npm run start:dev -- bursts
```

Every app listens on port `3000` by default. Set `port` to run several at once, for example `port=3001 npm run start:dev -- archiver`. In PowerShell: `$env:port=3001; npm run start:dev -- archiver`.

## Configuration

Every setting has a local default that matches [docker-compose.yml](docker-compose.yml), so local runs need no configuration. Override them through environment variables:

| Variable | Used by | Purpose |
|---|---|---|
| `KAFKA_BROKERS` | ingester, archiver, bursts | Comma-separated broker list |
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
| `port` | ingester, archiver, bursts | HTTP port |

Port mappings in Compose can be overridden too: `S3_PORT`, `SEAWEEDFS_FILER_PORT`, `SEAWEEDFS_ADMIN_PORT`, `POSTGRES_PORT`.

## Local services

| Service | URL | Use it to |
|---|---|---|
| Kafka | `localhost:9092` | Connect the apps from the host |
| Kafka UI (kafbat) | http://localhost:8080 | Browse topics and messages, and watch consumer-group lag |
| SeaweedFS S3 | http://localhost:8333 | S3 API endpoint |
| SeaweedFS filer | http://localhost:8888/buckets/wiki-archive/ | Browse archived objects in the browser |
| SeaweedFS admin | http://localhost:23646 | Manage buckets and S3 users, and see cluster status ([docker-compose.override.yml](docker-compose.override.yml)) |

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

## Tests

```bash
npm test             # unit tests (Vitest), in-memory Kafka and storage fakes, no Docker needed
npm run test:e2e     # real Kafka and SeaweedFS, run `docker compose up -d` first
npm run test:cov     # coverage
```

The fakes and the real implementations run the same contract suites, [kafka.contract.ts](libs/kafka/src/testing/kafka.contract.ts) and [storage.contract.ts](libs/storage/src/testing/storage.contract.ts): the fakes in unit tests, the real ones in e2e. So the fakes the apps' tests use behave like real Kafka and S3.
