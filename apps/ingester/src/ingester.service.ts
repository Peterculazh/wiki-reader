import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventSource } from 'eventsource';
import { CompactedTopicReader, MessageProducer } from '@app/kafka';

type RecentChangeEvent = {
  $schema: string;
  meta: {
    uri: string;
    request_id: string;
    id: string;
    domain: string;
    stream: string;
    dt: string;
    topic: string;
    partition: number;
    offset: number;
  };
  id: number;
  type: 'edit' | 'new' | 'log' | 'categorize' | 'external';
  namespace: number;
  title: string;
  title_url: string;
  comment: string;
  timestamp: number;
  user: string;
  bot: boolean;
  notify_url: string;
  server_url: string;
  server_name: string;
  server_script_path: string;
  wiki: string;
  parsedcomment: string;
};

/*
                {
          '$schema': '/mediawiki/recentchange/1.0.0',
          meta: {
            uri: 'https://zh.wikisource.org/wiki/Category:%E4%B8%AD%E5%8D%8E%E4%BA%BA%E6%B0%91%E5%85%B1%E5%92%8C%E5%9B%BD%E5%85%AC%E6%9C%89%E9%A2%86%E5%9F%9F',
            request_id: '5fbac195-ef56-4d32-9975-6b34c63b192c',
            id: '2022b569-39e4-4ac7-8d46-1239ed1a479c',
            domain: 'zh.wikisource.org',
            stream: 'mediawiki.recentchange',
            dt: '2026-10-20T16:27:02.451Z',
            topic: 'eqiad.mediawiki.recentchange',
            partition: 0,
            offset: 6625058801
          },
          id: 54388516,
          type: 'categorize',
          namespace: 14,
          title: 'Category:中华人民共和国公有领域',
          title_url: 'https://zh.wikisource.org/wiki/Category:%E4%B8%AD%E5%8D%8E%E4%BA%BA%E6%B0%91%E5%85%B1%E5%92%8C%E5%9B%BD%E5%85%AC%E6%9C%89%E9%A2%86%E5%9F%9F',
          comment: '[[:张陈左与韦润桃民间借贷纠纷一审民事判决书]]已添加至分类',
          timestamp: 1792513618,
          user: 'SuperGrey-bot',
          bot: true,
          notify_url: 'https://zh.wikisource.org/w/index.php?diff=11142868&oldid=0',
          server_url: 'https://zh.wikisource.org',
          server_name: 'zh.wikisource.org',
          server_script_path: '/w',
          wiki: 'zhwikisource',
          parsedcomment: '<a href="/wiki/%E5%BC%A0%E9%99%88%E5%B7%A6%E4%B8%8E%E9%9F%A6%E6%B6%A6%E6%A1%83%E6%B0%91%E9%97%B4%E5%80%9F%E8%B4%B7%E7%BA%A0%E7%BA%B7%E4%B8%80%E5%AE%A1%E6%B0%91%E4%BA%8B%E5%88%A4%E5%86%B3%E4%B9%A6" title="张陈左与韦润桃民间借贷纠纷一审民事判决书">张陈左与韦润桃民间借贷纠纷一审民事判决书</a>已添加至分类'
        }
        */

@Injectable()
export class IngesterService implements OnModuleInit, OnModuleDestroy {
  private eventsource: EventSource;

  constructor(
    private readonly producer: MessageProducer,
    private readonly compactedReader: CompactedTopicReader,
  ) {}

  async onModuleInit() {
    const resumeId = await this.readLatestEventId();
    console.log(
      resumeId
        ? `Resuming from ${resumeId}`
        : 'No stored position, starting live',
    );

    this.eventsource = new EventSource(
      'https://stream.wikimedia.org/v2/stream/recentchange',
      {
        fetch: (input, init) => {
          // Keep init: it carries the abort signal and the Accept / Last-Event-ID headers
          return fetch(input, {
            ...init,
            headers: {
              // Stored position goes first: after the first event the library's own Last-Event-ID wins
              ...(resumeId ? { 'Last-Event-ID': resumeId } : {}),
              ...init?.headers,
              'User-Agent':
                'wiki-pipeline/0.1 (https://github.com/peterculazh/wiki-reader; peterculazh@gmail.com) eventsource/5.1.3',
            },
          });
        },
      },
    );

    this.eventsource.onopen = () => {
      console.log('Connection to server opened.');
    };

    this.eventsource.onerror = (event) => {
      console.error(
        `EventSource error: ${event.message} (readyState ${this.eventsource.readyState})`,
      );
    };

    let lastStoredEventTimestamp = 0;
    this.eventsource.onmessage = async (event) => {
      try {
        await this.producer.send('wiki.changes', [{ value: event.data }]);

        const now = Date.now();

        if (now - lastStoredEventTimestamp >= 60_000) {
          lastStoredEventTimestamp = now;
          try {
            const id = event.lastEventId;
            // Compacted topic: broker rejects keyless records
            await this.producer.send('wiki.changes.latest', [
              { key: 'latest', value: JSON.stringify({ latestId: id }) },
            ]);
          } catch (err) {
            console.error('Failed to send latest event ID to Kafka:', err);
            lastStoredEventTimestamp = 0; // allow a retry on the next event
          }
        }
      } catch (err) {
        console.error('Failed to send event to Kafka:', err);
      }
    };
  }

  /**
   * Reads the last stored EventStreams position from the compacted `wiki.changes.latest` topic.
   * Returns null when nothing is stored yet or the read fails, so the stream starts live.
   */
  private async readLatestEventId(): Promise<string | null> {
    const topic = 'wiki.changes.latest';
    try {
      const stored = (await this.compactedReader.readAll(topic)).get('latest');
      if (!stored) return null;
      return (JSON.parse(stored) as { latestId?: string }).latestId ?? null;
    } catch (err) {
      console.error(`Failed to read latest event ID from ${topic}:`, err);
      return null;
    }
  }

  async onModuleDestroy() {
    // The producer disconnects later, in KafkaModule's shutdown hook
    this.eventsource.close();
  }
}
