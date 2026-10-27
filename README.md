# wiki-reader

A small pipeline that reads Wikipedia's live edit stream and archives it to S3-compatible storage, using Kafka in between.

```
Wikimedia EventStreams ──► ingester ──► Kafka: wiki.changes ──► archiver ──► S3 (wiki-archive)
                              │
                              └──► Kafka: wiki.changes.latest (compacted, resume position)
```

## Apps and libraries

NestJS monorepo ([nest-cli.json](nest-cli.json)):

| Path | What it does |
|---|---|
| [apps/ingester](apps/ingester) | Reads the [recentchange](https://stream.wikimedia.org/v2/stream/recentchange) server-sent events (SSE) stream and publishes every event to `wiki.changes`. About once a minute it saves the last event ID to the compacted topic `wiki.changes.latest`, so after a restart it resumes where it left off. |
| [apps/archiver](apps/archiver) | Consumes `wiki.changes` and writes each partition's messages to S3 as gzipped NDJSON chunks. |
| [libs/kafka](libs/kafka) | Kafka ports (`MessageProducer`, `MessageConsumerFactory`, `CompactedTopicReader`), a Confluent client implementation and an in-memory fake for tests. |
| [libs/storage](libs/storage) | `ObjectStorage` port, an S3 implementation (AWS SDK v3) and an in-memory fake for tests. |

### How the archiver writes chunks

- Messages are buffered per partition. A chunk is written when it reaches **300 messages**, or **60 s after its first message**, whichever comes first.
- Object key: `wiki.changes/partition=<p>/<first offset, zero-padded to 20>.jsonl.gz`, gzipped (about 7x smaller), one Kafka message per line. It is a plain `.gz` file with no `Content-Encoding`, so any tool that reads `.jsonl.gz` can open it directly.
- An offset is committed only after its chunk is stored. If a write fails, the archiver reads the partition again from the chunk's first offset and retries.
- A retry starts at the same offset, so it overwrites the same key. Delivery is at-least-once, and a retry leaves no duplicate objects behind.

## Prerequisites

- Node.js and npm
- Docker with Compose

## Getting started

```bash
npm install

# Kafka, Kafka UI, Postgres, SeaweedFS (S3), SeaweedFS admin UI
docker compose up -d

# In two terminals
npm run start:dev -- ingester
npm run start:dev -- archiver
```

Both apps listen on port `3000` by default. Set `port` for one of them to run both at once, for example `port=3001 npm run start:dev -- archiver`. In PowerShell: `$env:port=3001; npm run start:dev -- archiver`.

## Configuration

Every setting has a local default that matches [docker-compose.yml](docker-compose.yml), so local runs need no configuration. Override them through environment variables:

| Variable | Used by | Purpose |
|---|---|---|
| `KAFKA_BROKERS` | ingester, archiver | Comma-separated broker list |
| `S3_ENDPOINT` | archiver | S3-compatible endpoint. Leave it unset to use AWS. |
| `S3_REGION` | archiver | Bucket region |
| `S3_BUCKET` | archiver | Target bucket |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | archiver | S3 credentials. The local SeaweedFS identity is defined in [seaweedfs/s3.json](seaweedfs/s3.json). |
| `S3_CREATE_BUCKET` | archiver | Set to `false` to skip creating the bucket on startup (meant for local dev only) |
| `port` | ingester, archiver | HTTP port |

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
