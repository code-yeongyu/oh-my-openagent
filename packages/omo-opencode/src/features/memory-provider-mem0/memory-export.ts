export type ExportStatus = "pending" | "processing" | "completed" | "failed"

export interface ExportSchema {
  fields: string[]
  format?: "json" | "jsonl" | "csv"
}

export interface ExportFilters {
  user_id?: string
  agent_id?: string
  run_id?: string
  project_id?: string
  categories?: string[]
  created_after?: string
  created_before?: string
  [key: string]: unknown
}

export interface ExportRequest {
  schema: ExportSchema
  filters?: ExportFilters
  name?: string
}

export interface ExportJob {
  export_id: string
  status: ExportStatus
  download_url?: string
  error?: string
  created_at?: string
  completed_at?: string
}

export class MemoryExportError extends Error {
  constructor(
    message: string,
    public readonly exportId?: string,
  ) {
    super(message)
    this.name = "MemoryExportError"
  }
}

export interface ExportClient {
  createExport(request: ExportRequest): Promise<{ export_id: string }>
  getExport(export_id: string): Promise<ExportJob>
}

export interface PollOptions {
  intervalMs?: number
  maxAttempts?: number
  backoffFactor?: number
  onStatus?: (job: ExportJob) => void
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_INTERVAL_MS = 2000
const DEFAULT_MAX_ATTEMPTS = 60
const DEFAULT_BACKOFF = 1.5

export function validateExportRequest(request: ExportRequest): void {
  if (!request.schema || !Array.isArray(request.schema.fields)) {
    throw new MemoryExportError("Export request requires schema.fields array")
  }
  if (request.schema.fields.length === 0) {
    throw new MemoryExportError("Export schema.fields must not be empty")
  }
}

export async function createExportRequest(
  client: ExportClient,
  request: ExportRequest,
): Promise<string> {
  validateExportRequest(request)
  const { export_id } = await client.createExport(request)
  if (!export_id) {
    throw new MemoryExportError("Client returned empty export_id")
  }
  return export_id
}

export async function pollExport(
  client: ExportClient,
  export_id: string,
  options: PollOptions = {},
): Promise<ExportJob> {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const max = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const backoff = options.backoffFactor ?? DEFAULT_BACKOFF
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))

  let wait = interval
  for (let attempt = 0; attempt < max; attempt++) {
    const job = await client.getExport(export_id)
    options.onStatus?.(job)
    if (job.status === "completed") {
      return job
    }
    if (job.status === "failed") {
      throw new MemoryExportError(
        job.error ?? `Export ${export_id} failed`,
        export_id,
      )
    }
    if (attempt < max - 1) {
      await sleep(wait)
      wait = Math.min(wait * backoff, 30000)
    }
  }
  throw new MemoryExportError(
    `Export ${export_id} did not complete within ${max} attempts`,
    export_id,
  )
}
