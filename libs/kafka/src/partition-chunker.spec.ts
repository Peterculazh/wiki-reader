import { IncomingMessage } from './ports.js';
import { ChunkSink, PartitionChunker } from './partition-chunker.js';

const msgs = (from: number, n: number): IncomingMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    topic: 't',
    partition: 0,
    offset: String(from + i),
    key: null,
    value: `m${from + i}`,
    headers: {},
  }));

function sink(flush: ChunkSink['flush'] = async () => {}) {
  return {
    flush: vi.fn(flush),
    rewind: vi.fn<(offset: string) => void>(),
    onError: vi.fn<(err: unknown) => void>(),
  };
}

describe('PartitionChunker', () => {
  afterEach(() => vi.useRealTimers());

  it('flushes everything per push when batchSize is unset', async () => {
    const s = sink();
    const chunker = new PartitionChunker({}, s);

    await chunker.push(msgs(0, 5));

    expect(s.flush).toHaveBeenCalledOnce();
    expect(s.flush.mock.calls[0][0]).toHaveLength(5);
  });

  it('accumulates across pushes until batchSize is reached', async () => {
    const s = sink();
    const chunker = new PartitionChunker({ batchSize: 4 }, s);

    await chunker.push(msgs(0, 3));
    expect(s.flush).not.toHaveBeenCalled();
    await chunker.push(msgs(3, 6));

    expect(s.flush.mock.calls.map(([c]) => c.map((m) => m.offset))).toEqual([
      ['0', '1', '2', '3'],
      ['4', '5', '6', '7'],
    ]);
  });

  it('flushes a partial chunk after maxWaitMs, counted from its first message', async () => {
    vi.useFakeTimers();
    const s = sink();
    const chunker = new PartitionChunker(
      { batchSize: 10, maxWaitMs: 1_000 },
      s,
    );

    await chunker.push(msgs(0, 1));
    await vi.advanceTimersByTimeAsync(600);
    await chunker.push(msgs(1, 1)); // does not restart the timer
    await vi.advanceTimersByTimeAsync(400);
    await chunker.idle();

    expect(s.flush.mock.calls.map(([c]) => c.length)).toEqual([2]);
  });

  it('on failure clears the buffer and rewinds to the failed chunk start', async () => {
    const s = sink(async () => {
      throw new Error('s3 down');
    });
    const chunker = new PartitionChunker({ batchSize: 2 }, s);

    await chunker.push(msgs(10, 3));

    expect(s.flush).toHaveBeenCalledOnce();
    expect(s.rewind).toHaveBeenCalledWith('10');
    expect(s.onError).toHaveBeenCalledOnce();
    // The leftover m12 was dropped too: it is redelivered after the rewind
    await chunker.push(msgs(10, 1));
    expect(s.flush).toHaveBeenCalledOnce();
  });

  it('ignores the outcome of a flush that was in flight when dropped', async () => {
    let fail!: (err: Error) => void;
    const s = sink(() => new Promise((_, reject) => (fail = reject)));
    const chunker = new PartitionChunker({ batchSize: 1 }, s);

    const pushed = chunker.push(msgs(0, 1));
    await vi.waitFor(() => expect(s.flush).toHaveBeenCalled());
    chunker.drop();
    fail(new Error('commit on revoked partition'));
    await pushed;

    expect(s.rewind).not.toHaveBeenCalled();
    expect(s.onError).not.toHaveBeenCalled();
    await chunker.push(msgs(1, 1));
    expect(s.flush).toHaveBeenCalledOnce();
  });
});
