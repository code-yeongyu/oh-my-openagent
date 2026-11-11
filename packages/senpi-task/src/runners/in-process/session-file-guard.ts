import { readFileSync } from "node:fs"

import { RunnerError } from "./runner-error"

function isSessionHeaderEntry(entry: unknown): entry is { readonly type: "session"; readonly id: string } {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "type" in entry &&
    entry.type === "session" &&
    "id" in entry &&
    typeof entry.id === "string"
  )
}

// Eager resume-time validation of the transcript. senpi's loader TOLERATES unparseable lines and
// treats a file whose first parsed entry is not a session header as empty, and SessionManager.open
// is lazy - so without this check a corrupt/unreadable path would silently resurrect a child with
// no transcript instead of failing typed. Mirrors senpi's validity notion exactly: skip blank and
// unparseable lines, then require the first parsed entry to be a session header with a string id.
export function assertUsableSessionFile(sessionPath: string): void {
  let content: string
  try {
    content = readFileSync(sessionPath, "utf8")
  } catch (error) {
    throw new RunnerError({
      kind: "session_unavailable",
      message: `Child session file is unreadable: ${sessionPath}`,
      cause: error,
    })
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let entry: unknown
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (isSessionHeaderEntry(entry)) return
    throw new RunnerError({
      kind: "session_unavailable",
      message: `Child session file has no session header: ${sessionPath}`,
    })
  }
  throw new RunnerError({
    kind: "session_unavailable",
    message: `Child session file has no session header: ${sessionPath}`,
  })
}
