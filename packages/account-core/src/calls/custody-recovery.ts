import { randomUUID } from "node:crypto"
import { appendFile, readFile, rename, writeFile } from "node:fs/promises"
import type { CustodyRecord } from "./custody-log"

// The custody log's recovery step (security design 8.2, the security owner's ruling on review 6065026586), run under
// the log's lock: an operation whose starter is provably gone is closed as `interrupted`, under the operation's own
// principal and capability, with the cause as its code. A starter that is alive is never closed by anyone but itself,
// however long it runs; only a `started` record that names no process falls back to a deadline. Records past
// retention are dropped; every other line, a line that does not parse included, is kept byte for byte.

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000
/** For a `started` record that names no process: past this, nothing is waiting on it. */
const OPERATION_DEADLINE_MS = 60 * 60 * 1000

function parse(line: string): CustodyRecord | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as CustodyRecord) : undefined
  } catch {
    return undefined
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function interruption(record: CustodyRecord, now: number): "starter_ended" | "deadline_passed" | undefined {
  if (typeof record.pid === "number")
    return record.pid !== process.pid && !running(record.pid) ? "starter_ended" : undefined
  return now - Date.parse(record.at) >= OPERATION_DEADLINE_MS ? "deadline_passed" : undefined
}

const expired = (record: CustodyRecord | undefined, now: number): boolean => {
  const at = record === undefined ? Number.NaN : Date.parse(record.at)
  return Number.isFinite(at) && now - at >= RETENTION_MS
}

export async function recoverCustodyLog(path: string, now: number): Promise<void> {
  const text = await readFile(path, "utf8").catch(() => "")
  const lines = text.split("\n").filter(Boolean)
  const kept = lines.filter((line) => !expired(parse(line), now))
  if (kept.length !== lines.length) {
    const staging = `${path}.${process.pid}.tmp`
    await writeFile(staging, kept.map((line) => `${line}\n`).join(""), { mode: 0o600 })
    await rename(staging, path)
  }
  const records = kept.map(parse).filter((record) => record !== undefined)
  const ended = new Set(records.filter((record) => record.phase === "terminal").map((record) => record.operation_id))
  const closings = records.flatMap<CustodyRecord>((record) => {
    if (record.phase !== "started" || ended.has(record.operation_id)) return []
    const cause = interruption(record, now)
    if (cause === undefined) return []
    return [
      {
        id: randomUUID(),
        at: new Date(now).toISOString(),
        operation_id: record.operation_id,
        principal: record.principal,
        capability: record.capability,
        destination: "store",
        phase: "terminal",
        outcome: "interrupted",
        code: cause,
      },
    ]
  })
  if (closings.length > 0) await appendFile(path, closings.map((record) => `${JSON.stringify(record)}\n`).join(""))
}
