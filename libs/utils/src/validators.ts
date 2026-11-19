export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** The start of a message value, for log lines about skipped messages */
export function preview(value: string | null): string {
  if (value === null) return 'null';
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}
