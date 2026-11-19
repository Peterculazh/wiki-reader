/** The start of a message value, for log lines about skipped messages */
export function preview(value: string | null): string {
  if (value === null) return 'null';
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}
