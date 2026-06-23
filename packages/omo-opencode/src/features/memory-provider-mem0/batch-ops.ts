export const MAX_BATCH_SIZE = 1000

export interface BatchUpdateItem {
  memory_id: string
  text?: string
  metadata?: Record<string, unknown>
}

export interface BatchDeleteItem {
  memory_id: string
}

export interface BatchResult {
  total: number
  succeeded: number
  failed: number
  errors: Array<{ memory_id: string; error: string }>
}

export function chunkArray<T>(items: T[], maxSize: number = MAX_BATCH_SIZE): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += maxSize) {
    chunks.push(items.slice(i, i + maxSize))
  }
  return chunks
}

export interface BatchClient {
  batchUpdate(items: BatchUpdateItem[]): Promise<{ updated: number; failed: number }>
  batchDelete(ids: string[]): Promise<{ deleted: number; failed: number }>
}

export async function executeBatchUpdate(
  client: BatchClient,
  items: BatchUpdateItem[],
): Promise<BatchResult> {
  if (items.length === 0) return { total: 0, succeeded: 0, failed: 0, errors: [] }

  const chunks = chunkArray(items)
  let succeeded = 0
  let failed = 0
  const errors: BatchResult["errors"] = []

  for (const chunk of chunks) {
    try {
      const result = await client.batchUpdate(chunk)
      succeeded += result.updated
      failed += result.failed
    } catch (err) {
      failed += chunk.length
      errors.push({ memory_id: "(batch)", error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { total: items.length, succeeded, failed, errors }
}

export async function executeBatchDelete(
  client: BatchClient,
  ids: string[],
): Promise<BatchResult> {
  if (ids.length === 0) return { total: 0, succeeded: 0, failed: 0, errors: [] }

  const chunks = chunkArray(ids)
  let succeeded = 0
  let failed = 0
  const errors: BatchResult["errors"] = []

  for (const chunk of chunks) {
    try {
      const result = await client.batchDelete(chunk)
      succeeded += result.deleted
      failed += result.failed
    } catch (err) {
      failed += chunk.length
      errors.push({ memory_id: "(batch)", error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { total: ids.length, succeeded, failed, errors }
}
