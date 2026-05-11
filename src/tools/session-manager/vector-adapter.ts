import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { SearchResult } from "./types"

interface VectorAdapterOptions {
  adapterPath?: string
  topK?: number
  sessionId?: string
  spawnOverride?: typeof import("node:child_process").execFile
  timeoutMs?: number
}

interface VectorResultItem {
  path?: string
  session_id?: string
  title?: string
  score?: number
  match_type?: string[]
  snippet?: string
  source_type?: string
  heading_path?: string
  chunk_text?: string
  mtime?: string
  absolute_path?: string
}

function isVectorResultItem(input: unknown): input is VectorResultItem {
  if (typeof input !== "object" || input === null) return false
  const obj = input as Record<string, unknown>
  return typeof obj.session_id === "string" || typeof obj.path === "string"
}

function isValidSessionItem(item: VectorResultItem): boolean {
  const sid = item.session_id
  if (typeof sid !== "string" || sid.length === 0) return false
  if (typeof item.source_type === "string" && item.source_type !== "opencode_session") return false
  return true
}

function isVectorResultArray(input: unknown): input is VectorResultItem[] {
  return Array.isArray(input) && input.every(isVectorResultItem)
}

interface VectorOutputShape {
  results?: unknown
}

function isVectorOutput(input: unknown): input is VectorOutputShape {
  return typeof input === "object" && input !== null && "results" in input
}

function getDefaultAdapterPath(): string {
  const candidates = [
    join(
      process.env.HOME || "",
      "Library",
      "Mobile Documents",
      "iCloud~md~obsidian",
      "Documents",
      "Zettelkasten",
      ".agents",
      "skills",
      "search-note",
      "scripts",
      "query_lancedb.py",
    ),
    join(
      process.env.HOME || "",
      "Documents",
      "Zettelkasten",
      ".agents",
      "skills",
      "search-note",
      "scripts",
      "query_lancedb.py",
    ),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

function deterministicSuffix(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const abs = Math.abs(hash)
  return abs.toString(36).slice(0, 8)
}

function vectorItemToSearchResult(item: VectorResultItem): SearchResult {
  const role = (item.heading_path || "").replace("message/", "") || "unknown"
  const sessionID = item.session_id as string
  const snippetRaw = item.snippet || item.chunk_text || ""

  const stableSeed = [sessionID, item.path || "", snippetRaw.slice(0, 50), role].join(":")
  const suffix = deterministicSuffix(stableSeed)
  const messageID = `${sessionID}_vec_${suffix}`

  return {
    session_id: sessionID,
    message_id: messageID,
    role,
    excerpt: snippetRaw,
    match_count: 1,
    timestamp: undefined,
    match_type: item.match_type || ["semantic"],
    source: "vector",
    title: item.title || "",
    score: typeof item.score === "number" ? item.score : 0.5,
  }
}

export async function queryVectorAdapter(
  query: string,
  options: VectorAdapterOptions = {},
): Promise<SearchResult[]> {
  const adapterPath = options.adapterPath ?? getDefaultAdapterPath()

  if (!existsSync(adapterPath)) {
    return []
  }

  const args = [
    adapterPath,
    query,
    "--source",
    "opencode",
    "--mode",
    "auto",
    "--top-k",
    String(options.topK ?? 10),
  ]

  const cmd = "python3"
  const timeoutMs = options.timeoutMs ?? 15000
  const spawnFn = options.spawnOverride ?? execFile

  return new Promise<SearchResult[]>((resolve) => {
    const timeout = setTimeout(() => {
      resolve([])
    }, timeoutMs)

    spawnFn(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, _stderr) => {
      clearTimeout(timeout)

      if (error) {
        resolve([])
        return
      }

      if (!stdout || stdout.trim().length === 0) {
        resolve([])
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch {
        resolve([])
        return
      }

      const results: VectorResultItem[] = []
      if (isVectorOutput(parsed) && isVectorResultArray(parsed.results)) {
        results.push(...parsed.results)
      } else if (isVectorResultArray(parsed)) {
        results.push(...parsed)
      } else {
        resolve([])
        return
      }

      const seen = new Set<string>()
      const output: SearchResult[] = []
      for (const item of results) {
        if (!isValidSessionItem(item)) continue
        const sessionID = item.session_id as string
        if (options.sessionId !== undefined && sessionID !== options.sessionId) continue
        if (seen.has(sessionID)) continue
        seen.add(sessionID)
        output.push(vectorItemToSearchResult(item))
      }

      resolve(output)
    })
  })
}