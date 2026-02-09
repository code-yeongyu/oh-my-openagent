const TASK_ID_PATTERN = /^T-[A-Za-z0-9-]+$/

export function parseTaskId(id: string): string | null {
  if (!TASK_ID_PATTERN.test(id)) return null
  return id
}
