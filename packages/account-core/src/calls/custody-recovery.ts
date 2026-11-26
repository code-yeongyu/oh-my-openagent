import { randomUUID } from "node:crypto"
import { appendFile, readFile, rename, writeFile } from "node:fs/promises"
import type { CustodyRecord } from "./custody-log"
import { processState } from "./process-scope"

// The custody log's recovery step (security design 8.2, the security owner's ruling on review 6065026586), run under
// the log's lock: an operation whose starter is provably gone is closed as `interrupted`, under the operation's own
// principal and capability, with the cause as its code. A starter that is alive is never closed by anyone but itself,
// however long it runs; one whose pid now names a process that started at another time is gone (D22-17). A starter
// from another process-number space is never judged here: its operation is closed as `starter_scope_unreachable` only
// once it reaches the retention horizon; one written before D22-17 (no scope) whose pid is still taken is closed there as
// `starter_legacy_unverified`. Only a `started` record that names no process falls back to a deadline.
// Records past retention whose operation is closed are dropped; every other line, a line that does not parse included,
// is kept byte for byte.

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

type Interruption = "starter_ended" | "starter_scope_unreachable" | "starter_legacy_unverified" | "deadline_passed"

async function interruption(record: CustodyRecord, now: number): Promise<Interruption | undefined> {
  const age = now - Date.parse(record.at)
  if (typeof record.pid !== "number") return age >= OPERATION_DEADLINE_MS ? "deadline_passed" : undefined
  const state = await processState({
    pid: record.pid,
    ...(record.starter_start === undefined ? {} : { start: record.starter_start }),
    ...(record.starter_scope === undefined ? {} : { scope: record.starter_scope }),
  })
  if (state === "gone") return "starter_ended"
  if (age < RETENTION_MS) return undefined
  if (state === "elsewhere") return "starter_scope_unreachable"
  // A record from before D22-17 names its starter by pid alone, which a live process may since have taken.
  return record.starter_scope === undefined ? "starter_legacy_unverified" : undefined
}

// Past retention, and its operation closed (security design 8.2): an operation still open keeps its records.
const expired = (record: CustodyRecord | undefined, now: number, closed: ReadonlySet<string>): boolean => {
  const at = record === undefined ? Number.NaN : Date.parse(record.at)
  return record !== undefined && closed.has(record.operation_id) && Number.isFinite(at) && now - at >= RETENTION_MS
}

export async function recoverCustodyLog(path: string, now: number): Promise<void> {
  const text = await readFile(path, "utf8").catch(() => "")
  const lines = text.split("\n").filter(Boolean)
  const closed = new Set(
    lines
      .map(parse)
      .filter((record) => record?.phase === "terminal")
      .map((record) => record?.operation_id ?? ""),
  )
  const kept = lines.filter((line) => !expired(parse(line), now, closed))
  if (kept.length !== lines.length) {
    const staging = `${path}.${process.pid}.tmp`
    await writeFile(staging, kept.map((line) => `${line}\n`).join(""), { mode: 0o600 })
    await rename(staging, path)
  }
  const records = kept.map(parse).filter((record) => record !== undefined)
  const ended = new Set(records.filter((record) => record.phase === "terminal").map((record) => record.operation_id))
  const open = records.filter((record) => record.phase === "started" && !ended.has(record.operation_id))
  const causes = await Promise.all(open.map((record) => interruption(record, now)))
  const closings = open.flatMap<CustodyRecord>((record, index) => {
    const cause = causes[index]
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
