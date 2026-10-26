import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  IncomingMessage,
  MessageConsumerFactory,
  Subscription,
} from '@app/kafka';
import { ObjectStorage } from '@app/storage';

const CHUNK_SIZE = 300;

// Zero-padded so keys sort by offset: <topic>/partition=<p>/<first>-<last>.jsonl.
// A chunk always starts at a committed offset, so a retry overwrites the same key.
export function chunkKey(chunk: IncomingMessage[]): string {
  const first = chunk[0];
  const pad = (offset: string) => offset.padStart(20, '0');
  return `${first.topic}/partition=${first.partition}/${pad(first.offset)}-${pad(chunk.at(-1)!.offset)}.jsonl`;
}

@Injectable()
export class ArchiverService implements OnModuleInit, OnModuleDestroy {
  private subscription: Subscription;
  constructor(
    private readonly consumers: MessageConsumerFactory,
    private readonly storage: ObjectStorage,
  ) {}

  async onModuleInit() {
    const buffers = new Map<number, IncomingMessage[]>(); // one buffer per partition

    this.subscription = await this.consumers.subscribeEach(
      {
        groupId: 'archiver',
        topics: ['wiki.changes'],
        fromBeginning: true,
        // Kafka moved a partition to another instance, or we're stopping: drop its
        // buffer. Those messages were never committed, so they get read again.
        onRevoked: (partitions) =>
          partitions.forEach((p) => buffers.delete(p.partition)),
      },
      async (message, { commit, rewind }) => {
        const buffer = buffers.get(message.partition) ?? [];
        buffers.set(message.partition, buffer);
        buffer.push(message);
        if (buffer.length < CHUNK_SIZE) return;

        buffers.delete(message.partition);
        try {
          await this.storage.put(
            chunkKey(buffer),
            buffer.map((m) => m.value ?? 'null').join('\n') + '\n',
            { contentType: 'application/x-ndjson' },
          );
        } catch {
          rewind(buffer[0]); // S3 failed: re-read this partition from the buffer's first message
          return;
        }
        await commit(message); // commits everything up to and including this message
      },
    );
  }

  async onModuleDestroy() {
    await this.subscription?.stop();
  }
}
