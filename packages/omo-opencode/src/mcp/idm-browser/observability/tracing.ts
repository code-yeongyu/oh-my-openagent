import { join } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"

const TRACES_DIR = join(homedir(), "Library", "Caches", "idm", "browser", "traces")

export type TraceEntry = {
  timestamp: number
  tool: string
  sessionId?: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  durationMs: number
}

export function createTracer() {
  const entries: TraceEntry[] = []

  function record(entry: TraceEntry): void {
    entries.push(entry)
  }

  function getAll(): TraceEntry[] {
    return [...entries]
  }

  function getErrors(): TraceEntry[] {
    return entries.filter(e => e.error !== undefined)
  }

  async function saveOnError(context: string): Promise<string | null> {
    const errors = getErrors()
    if (errors.length === 0) return null

    await mkdir(TRACES_DIR, { recursive: true })
    const filename = `trace-${context}-${Date.now()}.jsonl`
    const path = join(TRACES_DIR, filename)
    const lines = entries.map(e => JSON.stringify(e)).join("\n")
    await writeFile(path, lines, "utf8")

    return path
  }

  function clear(): void {
    entries.length = 0
  }

  return { record, getAll, getErrors, saveOnError, clear }
}

export type Tracer = ReturnType<typeof createTracer>
