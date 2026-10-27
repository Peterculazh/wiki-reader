import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  IncomingMessage,
  MessageConsumerFactory,
  Subscription,
} from '@app/kafka';
import { ObjectStorage } from '@app/storage';

const CHUNK_SIZE = 300;
// Flush a partial chunk this long after its first message, so a quiet partition still gets archived
const MAX_BUFFER_AGE_MS = 60_000;

// Async variant: compression runs on libuv's thread pool, not the event loop
const gzip = promisify(gzipCallback);

// Zero-padded so keys sort by offset: <topic>/partition=<p>/<first>.jsonl.gz.
// Named by the first offset only: a retry starts at the same committed offset but
// may end later, so it overwrites the earlier object with a superset instead of
// leaving an overlapping one next to it.
export function chunkKey(chunk: IncomingMessage[]): string {
  const { topic, partition, offset } = chunk[0];
  return `${topic}/partition=${partition}/${offset.padStart(20, '0')}.jsonl.gz`;
}

@Injectable()
export class ArchiverService implements OnModuleInit, OnModuleDestroy {
  private subscription: Subscription;
  constructor(
    private readonly consumers: MessageConsumerFactory,
    private readonly storage: ObjectStorage,
  ) {}

  async onModuleInit() {
    // The lib buffers each partition, commits a chunk once this handler resolves,
    // and on a throw (S3 failed) re-reads the partition from the chunk's first message
    this.subscription = await this.consumers.subscribe(
      {
        groupId: 'archiver',
        topics: ['wiki.changes'],
        fromBeginning: true,
        batchSize: CHUNK_SIZE,
        maxWaitMs: MAX_BUFFER_AGE_MS,
      },
      async (chunk) => {
        console.log(
          `Archiving ${chunk.length} messages from ${chunk[0].topic}[${chunk[0].partition}]`,
        );
        // A plain .gz file (no Content-Encoding), so clients download it as-is
        // instead of decompressing it on the fly; JSON compresses about 7x
        const body = await gzip(
          chunk.map((m) => m.value ?? 'null').join('\n') + '\n',
        );
        await this.storage.put(chunkKey(chunk), body, {
          contentType: 'application/gzip',
        });
      },
    );
  }

  async onModuleDestroy() {
    await this.subscription?.stop();
  }
}
