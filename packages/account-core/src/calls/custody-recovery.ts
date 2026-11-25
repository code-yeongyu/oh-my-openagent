import { randomUUID } from "node:crypto"
import { appendFile, readFile, rename, writeFile } from "node:fs/promises"
import type { CustodyRecord } from "./custody-log"

// The custody log's recovery step (security design 8.2, the security owner's ruling on review 6065026586): an operation
// whose starter is provably gone is closed as `interrupted`, under the operation's own principal and capability, with
// the cause as its code. An operation whose starter still runs is never closed by anyone but itself. The file is
// rewritten only to drop records past retention; every other record is appended.

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000
/** Past a sign-in's own 30-minute deadline: an operation open this long has no starter waiting on it. */
const OPERATION_DEADLINE_MS = 60 * 60 * 1000

function parse(line: string): CustodyRecord | undefined {
  try {
    return JSON.parse(line) as CustodyRecord
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
  if (now - Date.parse(record.at) >= OPERATION_DEADLINE_MS) return "deadline_passed"
  if (record.pid !== undefined && record.pid !== process.pid && !running(record.pid)) return "starter_ended"
  return undefined
}

export async function recoverCustodyLog(path: string, now: number): Promise<void> {
  const text = await readFile(path, "utf8").catch(() => "")
  const records = text
    .split("\n")
    .filter(Boolean)
    .map(parse)
    .filter((record) => record !== undefined)
  const kept = records.filter((record) => now - Date.parse(record.at) < RETENTION_MS)
  if (kept.length !== records.length) {
    const staging = `${path}.${process.pid}.tmp`
    await writeFile(staging, kept.map((record) => `${JSON.stringify(record)}\n`).join(""), { mode: 0o600 })
    await rename(staging, path)
  }
  const ended = new Set(kept.filter((record) => record.phase === "terminal").map((record) => record.operation_id))
  const closings = kept.flatMap<CustodyRecord>((record) => {
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
