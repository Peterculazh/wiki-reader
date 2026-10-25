import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  IncomingMessage,
  MessageConsumerFactory,
  Subscription,
} from '@app/kafka';

@Injectable()
export class ArchiverService implements OnModuleInit {
  private subscription: Subscription;
  constructor(private readonly consumers: MessageConsumerFactory) {}

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
        if (buffer.length < 300) return;

        buffers.delete(message.partition);
        try {
          await this.s3.put(buffer);
        } catch {
          rewind(buffer[0]); // S3 failed: re-read this partition from the buffer's first message
          return;
        }
        await commit(message); // commits everything up to and including this message
      },
    );
  }
}
