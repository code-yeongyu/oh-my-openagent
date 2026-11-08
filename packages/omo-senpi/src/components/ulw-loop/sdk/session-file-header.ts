import { closeSync, openSync, readSync } from "node:fs"

const HEADER_PROBE_BYTES = 64 * 1024

export type SessionFileCwd = { readonly cwd: string } | { readonly problem: string }

function firstLine(path: string): string {
  const fd = openSync(path, "r")
  try {
    const buffer = Buffer.alloc(HEADER_PROBE_BYTES)
    const read = readSync(fd, buffer, 0, HEADER_PROBE_BYTES, 0)
    const text = buffer.subarray(0, read).toString("utf8")
    const newline = text.indexOf("\n")
    return newline === -1 ? text : text.slice(0, newline)
  } finally {
    closeSync(fd)
  }
}

// The session JSONL opens with `{"type":"session",...,"cwd":"<session cwd>"}`, the exact cwd the
// host bound the session to; it is the faithful second source when PI_SESSION_CWD did not survive.
export function readSessionFileCwd(sessionFile: string | undefined): SessionFileCwd {
  const path = sessionFile?.trim()
  if (!path) return { problem: "PI_SESSION_FILE is unset" }
  let line: string
  try {
    line = firstLine(path)
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unreadable"
    return { problem: `PI_SESSION_FILE is unreadable (${code})` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { problem: "PI_SESSION_FILE does not start with a JSON session header" }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { problem: "PI_SESSION_FILE header is not an object" }
  const cwd = "cwd" in parsed && typeof parsed.cwd === "string" ? parsed.cwd.trim() : ""
  return cwd ? { cwd } : { problem: "PI_SESSION_FILE header records no cwd" }
}
