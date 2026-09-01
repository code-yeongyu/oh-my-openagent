import type { MemoryCommit } from "./repo-types"

export function parseLogOutput(output: string): MemoryCommit[] {
  return output.split("\x1e").slice(1).map((record) => {
    const [sha = "", subject = "", body = "", authorName = "", authorEmail = "", committedAt = ""] = record.split("\x1f")
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
  })
}

export function parseNulPaths(output: string): string[] {
  return output.split("\0").filter(Boolean)
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
