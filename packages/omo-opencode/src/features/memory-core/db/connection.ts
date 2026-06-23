import postgres from "postgres"

export interface MemoryDbConfig {
  url: string
  max?: number
  idle_timeout?: number
}

let _sql: ReturnType<typeof postgres> | undefined

export function getMemoryDb(config: MemoryDbConfig): ReturnType<typeof postgres> {
  if (!_sql) {
    _sql = postgres(config.url, {
      max: config.max ?? 10,
      idle_timeout: config.idle_timeout ?? 30,
    })
  }
  return _sql
}

export async function closeMemoryDb(): Promise<void> {
  if (_sql) {
    await _sql.end()
    _sql = undefined
  }
}
