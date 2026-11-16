import { readFileSync } from "node:fs"

import type { ProcessIdentity } from "./session-locks.ts"

function stat(pid: number): { readonly ppid: number; readonly start: number; readonly name: string } | undefined {
  let text: string
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error) return undefined
    throw error
  }
  const open = text.indexOf("(")
  const close = text.lastIndexOf(")")
  const fields = text.slice(close + 2).split(" ")
  const ppid = Number(fields[1])
  const start = Number(fields[19])
  if (open === -1 || close === -1 || !Number.isSafeInteger(ppid) || !Number.isSafeInteger(start)) return undefined
  return { ppid, start, name: text.slice(open + 1, close) }
}

/** A process's start time in clock ticks since boot (`/proc/<pid>/stat` field 22): the engine's `processStart` (Linux). */
export function processIdentity(pid: number): ProcessIdentity | undefined {
  const facts = stat(pid)
  return facts === undefined ? undefined : { pid, processStart: facts.start }
}
