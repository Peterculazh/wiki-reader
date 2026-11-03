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

# 3 Kafka brokers, Kafka UI, Postgres, SeaweedFS (S3), SeaweedFS admin UI
docker compose up -d

# In separate terminals
npm run start:dev -- ingester
npm run start:dev -- archiver
npm run start:dev -- bursts
```

Before the first start, create the env files (they are git-ignored, see [Configuration](#configuration)):

```bash
# .env: shared by every app
KAFKA_BROKERS=localhost:9092,localhost:9094,localhost:9096

# apps/ingester/.env, apps/archiver/.env, apps/bursts/.env: one port per app
PORT=3001   # 3002, 3003
```

If you ran the project when Compose had a single `broker` service, run `docker compose up -d --remove-orphans` once. The old container can keep host port `9092` reserved, and `kafka-1` then starts without a network.

## Configuration

Each app loads env files with [`@nestjs/config`](https://docs.nestjs.com/techniques/configuration): first `apps/<app>/.env`, then the shared `.env` in the repo root. A key in the app's file wins over the shared one, and a real environment variable wins over both. [.env.example](.env.example) lists the shared keys.

`KAFKA_BROKERS` has no default: an app fails on startup if it's missing. List every broker. The list is only used for the first connection (the client learns the rest of the cluster from metadata), but if it names just one broker and that broker is down, the app can't start.

The other settings have local defaults that match [docker-compose.yml](docker-compose.yml):

| Variable | Used by | Purpose |
|---|---|---|
| `KAFKA_BROKERS` | ingester, archiver, bursts | Comma-separated broker list. Required. |
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
| `PORT` | ingester, archiver, bursts | HTTP port (default `3000`). Set a different one per app to run them side by side. |

The archiver reads the `S3_*` variables before the env files are loaded, so for now set them in the real environment, not in `.env` (see [Known issues](#known-issues)).

Port mappings in Compose can be overridden too: `S3_PORT`, `SEAWEEDFS_FILER_PORT`, `SEAWEEDFS_ADMIN_PORT`, `POSTGRES_PORT`.

## Local services

| Service | URL | Use it to |
|---|---|---|
| Kafka | `localhost:9092`, `localhost:9094`, `localhost:9096` | Connect the apps from the host (brokers `kafka-1`, `kafka-2`, `kafka-3`) |
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

## Kafka replication

### Setup

- **Three KRaft nodes** (`kafka-1`, `kafka-2`, `kafka-3`), each both broker and controller. Three controllers keep a quorum with one node down; with two down the cluster stops.
- **Replication factor 3 and `min.insync.replicas=2`** as broker defaults, so topics the apps create get them too (`wiki.changes` is auto-created by the first write).
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

## Known issues

- **`wiki.changes.latest` isn't compacted.** The ingester never creates it, so the broker auto-creates it with `cleanup.policy=delete`. After `retention.ms` (7 days by default) the stored position is deleted and the ingester starts live, without replaying what it missed. It should create the topic with `cleanup.policy=compact` on startup, the way bursts creates `wiki.bursts`.
- **The ingester drops events it fails to send.** It reads the stream with no backpressure, and on a failed `send()` it logs the event and moves on. It still saves later event IDs as its position, so a restart doesn't replay the gap. Instead it should stop reading on a failed send and reconnect from the last event it stored successfully (at least once; consumers can dedupe by event ID).
- **`StorageModule` has no `forRootAsync`.** The archiver reads `S3_*` from `process.env` while modules are imported, before the env files are loaded, so values in `.env` are ignored.

## Tests

```bash
npm test             # unit tests (Vitest), in-memory Kafka and storage fakes, no Docker needed
npm run test:e2e     # real Kafka and SeaweedFS, run `docker compose up -d` first
npm run test:cov     # coverage
```

The fakes and the real implementations run the same contract suites, [kafka.contract.ts](libs/kafka/src/testing/kafka.contract.ts) and [storage.contract.ts](libs/storage/src/testing/storage.contract.ts): the fakes in unit tests, the real ones in e2e. So the fakes the apps' tests use behave like real Kafka and S3.
