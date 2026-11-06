import { isAbsolute, join, resolve } from "node:path"

import {
  MAX_OMO_DISCOVERY_OPERATIONS,
  MAX_OMO_SESSION_HEADERS,
  OMO_HEADER_READ_BYTES,
  OMO_STARTUP_ONLY_MAX_BYTES,
} from "./constants"
import { readFileStringOrEmpty, realPathOr, statOrNull, type SessionHistoryFs } from "./session-history-fs"

export interface OmoProjectCandidate {
  readonly source: "omo"
  readonly cwd: string
  readonly threadCount: 0
  readonly lastActiveAtMs: number | null
}

export interface OmoDiscovery {
  readonly projects: ReadonlyArray<OmoProjectCandidate>
  readonly found: number
  readonly read: number
  readonly truncated: boolean
}

/** Entry kinds a session records on its own while it starts; anything else happened in the session. */
const STARTUP_ENTRY_TYPES: ReadonlySet<string> = new Set(["model_change", "thinking_level_change", "custom", "custom_message"])

const parseObject = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : null
  } catch {
    return null
  }
}

async function peekSessionHeader(fs: SessionHistoryFs, filePath: string): Promise<{ id: string | null; cwd: string | null }> {
  let raw: Uint8Array | null = null
  try {
    const file = await fs.open(filePath)
    try {
      raw = await file.read(OMO_HEADER_READ_BYTES)
    } finally {
      await file.close().catch(() => undefined)
    }
  } catch {
    return { id: null, cwd: null }
  }
  if (raw === null) return { id: null, cwd: null }
  const newline = raw.indexOf(0x0a)
  const header = parseObject(new TextDecoder().decode(newline === -1 ? raw : raw.subarray(0, newline)))
  const id = header?.["id"]
  const cwd = header?.["cwd"]
  if (header === null || (id !== undefined && typeof id !== "string") || (cwd !== undefined && typeof cwd !== "string")) {
    return { id: null, cwd: null }
  }
  return { id: typeof id === "string" ? id : null, cwd: typeof cwd === "string" ? cwd : null }
}

/** True for a readable session holding a header and nothing but startup records (an app's own probe session). */
async function holdsOnlyStartupRecords(fs: SessionHistoryFs, filePath: string): Promise<boolean> {
  const lines = (await readFileStringOrEmpty(fs, filePath)).split("\n").filter((line) => line.trim().length > 0)
  const [headerLine, ...entryLines] = lines
  if (headerLine === undefined || parseObject(headerLine)?.["type"] !== "session") return false
  return entryLines.every((line) => {
    const type = parseObject(line)?.["type"]
    return typeof type === "string" && STARTUP_ENTRY_TYPES.has(type)
  })
}

interface SessionFile {
  readonly filePath: string
  readonly mtimeMs: number | null
  readonly size: number
}

async function listSessionFiles(fs: SessionHistoryFs, roots: ReadonlyArray<string>) {
  let operations = MAX_OMO_DISCOVERY_OPERATIONS
  const seenRoots = new Set<string>()
  const files: Array<SessionFile> = []
  const spend = () => operations-- > 0
  for (const root of roots) {
    if (!spend()) return { files, truncated: true }
    const identity = await realPathOr(fs, resolve(root))
    if (seenRoots.has(identity)) continue
    seenRoots.add(identity)
    if (!spend()) return { files, truncated: true }
    let names: ReadonlyArray<string>
    try {
      names = await fs.readDirectory(root)
    } catch {
      continue
    }
    const directories = [root, ...names.filter((name) => name.startsWith("--") && name.endsWith("--")).map((name) => join(root, name))]
    for (const directory of directories) {
      if (!spend()) return { files, truncated: true }
      let entries: ReadonlyArray<string>
      try {
        entries = directory === root ? names : await fs.readDirectory(directory)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue
        if (!spend()) return { files, truncated: true }
        const filePath = join(directory, entry)
        const stats = await statOrNull(fs, filePath)
        if (stats !== null && stats.type === "File") files.push({ filePath, mtimeMs: stats.mtimeMs, size: stats.size })
      }
    }
  }
  return { files, truncated: false }
}

/**
 * Projects the omo CLI has run sessions in. A folder is offered only for a session in which something
 * happened; one confirmed session per folder is enough, so a confirmed folder is never read again.
 */
export async function discoverOmoCliProjects(fs: SessionHistoryFs, roots: ReadonlyArray<string>): Promise<OmoDiscovery> {
  const listed = await listSessionFiles(fs, roots)
  const files = listed.files.toSorted(
    (left, right) => (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0) || left.filePath.localeCompare(right.filePath),
  )
  const selected = files.slice(0, MAX_OMO_SESSION_HEADERS)
  const projects: Array<OmoProjectCandidate> = []
  const confirmedCwds = new Set<string>()
  for (const file of selected) {
    const header = await peekSessionHeader(fs, file.filePath)
    if (header.id === null || header.id.trim().length === 0 || header.cwd === null || !isAbsolute(header.cwd)) continue
    if (!confirmedCwds.has(header.cwd) && file.size <= OMO_STARTUP_ONLY_MAX_BYTES && (await holdsOnlyStartupRecords(fs, file.filePath))) {
      continue
    }
    confirmedCwds.add(header.cwd)
    projects.push({ source: "omo", cwd: header.cwd, threadCount: 0, lastActiveAtMs: file.mtimeMs })
  }
  return {
    projects,
    found: files.length,
    read: selected.length,
    truncated: listed.truncated || files.length > MAX_OMO_SESSION_HEADERS,
  }
}
