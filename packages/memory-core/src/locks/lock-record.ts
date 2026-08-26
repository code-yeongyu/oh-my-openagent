import { randomUUID } from "node:crypto"
import { hostname } from "node:os"

import { getProcessStartIdentity } from "./process-identity"

export type LockRecord = {
  readonly pid: number
  readonly process_start: string
  readonly hostname: string
  readonly nonce: string
  readonly created_at: string
  readonly purpose: string
  readonly run_id?: string
}

export type CreateLockRecordOptions = {
  readonly runId?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function parseLockRecord(content: string): LockRecord | null {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null

  const candidate = value as Record<string, unknown>
  if (!Number.isInteger(candidate.pid) || Number(candidate.pid) <= 0) return null
  if (!isNonEmptyString(candidate.process_start)) return null
  if (!isNonEmptyString(candidate.hostname)) return null
  if (!isNonEmptyString(candidate.nonce)) return null
  if (!isNonEmptyString(candidate.created_at) || Number.isNaN(Date.parse(candidate.created_at))) return null
  if (!isNonEmptyString(candidate.purpose)) return null
  if (candidate.run_id !== undefined && !isNonEmptyString(candidate.run_id)) return null

  return {
    pid: Number(candidate.pid),
    process_start: candidate.process_start,
    hostname: candidate.hostname,
    nonce: candidate.nonce,
    created_at: candidate.created_at,
    purpose: candidate.purpose,
    ...(candidate.run_id === undefined ? {} : { run_id: candidate.run_id }),
  }
}

export async function createLockRecord(
  purpose: string,
  options: CreateLockRecordOptions = {},
): Promise<LockRecord> {
  if (purpose.length === 0) throw new Error("lock purpose must not be empty")
  const processStart = await getProcessStartIdentity(process.pid)
  return {
    pid: process.pid,
    process_start: processStart ?? "unavailable",
    hostname: hostname(),
    nonce: randomUUID(),
    created_at: new Date().toISOString(),
    purpose,
    ...(options.runId === undefined ? {} : { run_id: options.runId }),
  }
}
