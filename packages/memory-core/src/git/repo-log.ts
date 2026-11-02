import type { MemoryCommit } from "./repo-types"

export function parseLogOutput(output: string): MemoryCommit[] {
  return output.split("\x1e").slice(1).map((record) => parseRecord(record.split("\x1f")))
}

/**
 * `git log --name-only -z` output for the same format: each record's last field is the commit date,
 * a NUL, then the commit's paths, each NUL-terminated and the first one led by a newline.
 */
export function parseLogOutputWithPaths(output: string): MemoryCommit[] {
  return output.split("\x1e").slice(1).map((record) => {
    const fields = record.split("\x1f")
    const [committedAt = "", ...paths] = (fields.pop() ?? "").split("\0")
    return {
      ...parseRecord([...fields, committedAt]),
      paths: paths.map((path) => path.replace(/^\n/, "")).filter(Boolean),
    }
  })
}

function parseRecord(fields: readonly string[]): MemoryCommit {
  const [sha = "", subject = "", body = "", authorName = "", authorEmail = "", committedAt = ""] = fields
  const normalizedBody = body.replace(/\r?\n$/, "")
  return {
    sha,
    subject,
    body: normalizedBody,
    authorName,
    authorEmail,
    committedAt: committedAt.trim(),
    trailers: parseTrailers(normalizedBody),
  }
}

function parseTrailers(body: string): Readonly<Record<string, string>> {
  const trailers: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const match = /^([^:\s][^:]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1]?.trim()
    if (key !== undefined && key.length > 0) trailers[key] = match[2] ?? ""
  }
  return trailers
}
