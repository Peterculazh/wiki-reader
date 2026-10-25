import { KafkaJS } from '@confluentinc/kafka-javascript';

export type KafkaModuleOptions = {
  clientId: string;
  brokers: string[];
};

export const KAFKA_OPTIONS = Symbol('KAFKA_OPTIONS');
export const KAFKA_CLIENT = Symbol('KAFKA_CLIENT');

export function createKafkaClient(options: KafkaModuleOptions): KafkaJS.Kafka {
  return new KafkaJS.Kafka({
    kafkaJS: {
      clientId: options.clientId,
      brokers: options.brokers,
    },
  });
}

export function toHeaders(
  headers: KafkaJS.IHeaders | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined) continue;
    // Repeated headers arrive as an array; keep the last one
    const last = Array.isArray(value) ? value[value.length - 1] : value;
    if (last !== undefined) result[name] = last.toString();
  }
  return result;
}
