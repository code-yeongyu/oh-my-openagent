import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { threadToolFailure, type ThreadToolFailure } from "./errors"

/**
 * A retired thread (2026-11-27): thread_close retires the thread it names, live or not, and a seat takeover closes the old
 * seat's thread naming its `role` and `successor`. Retirement is durable: no wake, no send and no reopen made for a read
 * or a send brings the session back; only an explicit reopen (`thread_create { thread }`) lifts it. The mark is one file
 * per durable id under `<sessions>/retired/`, on the device that closed the thread. The thread's holder also counts its
 * transcript's own record of a close on request (`wake/session-target.ts` `closed_at`, #14273), so a close made from
 * another device retires the session there too.
 */
export type RetiredMark = {
  readonly retired_at: number
  readonly role?: string
  readonly successor?: string
  readonly reopened_at?: number
}

export type Retirement = {
  readonly retired_at: number
  readonly role?: string
  readonly successor?: string
}

const RETIRED_DIRECTORY = "retired"

const markPath = (sessionsDirectory: string, durableId: string): string =>
  join(sessionsDirectory, RETIRED_DIRECTORY, `${encodeURIComponent(durableId)}.json`)

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)
const instant = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

export function readRetiredMark(sessionsDirectory: string, durableId: string): RetiredMark | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(markPath(sessionsDirectory, durableId), "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const retiredAt = instant(record["retired_at"])
  if (retiredAt === undefined) return undefined
  const role = text(record["role"])
  const successor = text(record["successor"])
  const reopenedAt = instant(record["reopened_at"])
  return {
    retired_at: retiredAt,
    ...(role === undefined ? {} : { role }),
    ...(successor === undefined ? {} : { successor }),
    ...(reopenedAt === undefined ? {} : { reopened_at: reopenedAt }),
  }
}

function writeMark(sessionsDirectory: string, durableId: string, mark: RetiredMark): void {
  const path = markPath(sessionsDirectory, durableId)
  mkdirSync(join(sessionsDirectory, RETIRED_DIRECTORY), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(mark), { mode: 0o600 })
  renameSync(temporary, path)
}

export function retireThread(
  sessionsDirectory: string,
  durableId: string,
  retirement: Retirement,
): void {
  writeMark(sessionsDirectory, durableId, retirement)
}

export function recordReopen(sessionsDirectory: string, durableId: string, at: number): void {
  const mark = readRetiredMark(sessionsDirectory, durableId)
  if (mark === undefined) return
  writeMark(sessionsDirectory, durableId, { ...mark, reopened_at: at })
}

/**
 * Whether the thread is retired now: the newest of its mark and its transcript's close on request, unless an explicit
 * reopen came after it. `closedAt` is the holder's transcript record, absent anywhere else.
 */
export function retiredFailure(
  thread: string,
  retirement: Retirement,
  device?: string,
): { readonly kind: "error"; readonly error: ThreadToolFailure } {
  const handedTo =
    retirement.successor === undefined
      ? ""
      : ` Its ${retirement.role === undefined ? "role" : `role ${retirement.role}`} is held by ${retirement.successor} now.`
  return {
    kind: "error",
    error: threadToolFailure(
      "target_retired",
      `Thread ${thread} was retired at ${new Date(retirement.retired_at).toISOString()} and takes no message.${handedTo}`,
      retirement.successor === undefined
        ? "Send to the session that holds its role now; reopen it with tool.thread_create({ thread }) only if it must run again."
        : `Send to ${retirement.successor} instead.`,
      {
        thread,
        retired_at: new Date(retirement.retired_at).toISOString(),
        ...(retirement.role === undefined ? {} : { role: retirement.role }),
        ...(retirement.successor === undefined ? {} : { successor: retirement.successor }),
        ...(device === undefined ? {} : { device }),
      },
    ),
  }
}

export function retirementOf(
  sessionsDirectory: string,
  durableId: string,
  closedAt?: number,
): Retirement | undefined {
  const mark = readRetiredMark(sessionsDirectory, durableId)
  const retiredAt = Math.max(mark?.retired_at ?? -Infinity, closedAt ?? -Infinity)
  if (retiredAt === -Infinity || retiredAt <= (mark?.reopened_at ?? -Infinity)) return undefined
  return {
    retired_at: retiredAt,
    ...(mark?.role === undefined ? {} : { role: mark.role }),
    ...(mark?.successor === undefined ? {} : { successor: mark.successor }),
  }
}
