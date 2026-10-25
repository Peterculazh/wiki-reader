import { setTimeout as sleep } from 'node:timers/promises';
import { IncomingMessage } from './ports.js';

export type ChunkerOptions = {
  /** Messages per chunk. Unset: every fetched batch is flushed as it arrives. */
  batchSize?: number;
  /** Flush a partial chunk this long after its first message arrived. */
  maxWaitMs?: number;
  /** Pause after a failed flush before the partition is fed again. */
  retryDelayMs?: number;
};

export type ChunkSink = {
  /** Hands the chunk to the app and commits it. Throws if either fails. */
  flush(messages: IncomingMessage[]): Promise<void>;
  /** After a failed flush: make the source redeliver from `offset`. */
  rewind(offset: string): void;
  onError(error: unknown): void;
};

/**
 * Buffers one topic-partition's messages into fixed-size chunks. Everything runs
 * on a single promise chain, so pushes and timer flushes never overlap, and
 * `push` resolves only once its full chunks are flushed (backpressure).
 *
 * Buffered messages are never committed: whatever is in memory when a flush
 * fails, or when the partition is dropped, is redelivered from the chunk start.
 */
export class PartitionChunker {
  private buffer: IncomingMessage[] = [];
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();
  private dropped = false;

  constructor(
    private readonly options: ChunkerOptions,
    private readonly sink: ChunkSink,
  ) {}

  push(messages: IncomingMessage[]): Promise<void> {
    return this.enqueue(async () => {
      this.buffer.push(...messages);
      const size = this.options.batchSize ?? this.buffer.length;
      while (this.buffer.length >= size && this.buffer.length > 0) {
        if (!(await this.flush(size))) return;
      }
      this.armTimer();
    });
  }

  /** Discards the buffer without committing (partition revoked or consumer stopping). */
  drop(): void {
    this.dropped = true;
    this.buffer = [];
    clearTimeout(this.timer);
  }

  /** Resolves once queued pushes and flushes are done. */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(step: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(() => (this.dropped ? undefined : step()));
    return this.chain;
  }

  private async flush(size: number): Promise<boolean> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const chunk = this.buffer.slice(0, size);
    try {
      await this.sink.flush(chunk);
    } catch (err) {
      if (this.dropped) return false;
      this.sink.onError(err);
      this.buffer = [];
      this.sink.rewind(chunk[0].offset);
      if (this.options.retryDelayMs) await sleep(this.options.retryDelayMs);
      return false;
    }
    if (!this.dropped) this.buffer = this.buffer.slice(size);
    return true;
  }

  private armTimer() {
    const { maxWaitMs } = this.options;
    if (maxWaitMs === undefined || this.timer || this.buffer.length === 0)
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.enqueue(async () => {
        if (this.buffer.length > 0) await this.flush(this.buffer.length);
        this.armTimer();
      });
    }, maxWaitMs);
  }
}
