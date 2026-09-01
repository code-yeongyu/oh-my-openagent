export function getMessageCount(data: unknown): number {
  return Array.isArray(data) ? data.length : 0
}
