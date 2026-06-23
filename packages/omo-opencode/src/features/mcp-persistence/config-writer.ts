import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { McpEnabledState, McpStateMap } from "./diff"

const SCHEMA_URL = "https://opencode.ai/config.json"

type McpEntry = { enabled?: boolean } & Record<string, unknown>
type OpencodeJson = {
  $schema?: string
  mcp?: Record<string, McpEntry>
} & Record<string, unknown>

export interface OpencodeConfigWriterOpts {
  directory: string
  fileName?: string
}

export function getConfigPath(opts: OpencodeConfigWriterOpts): string {
  return join(opts.directory, opts.fileName ?? "opencode.json")
}

export function readPersistedMcpStates(
  opts: OpencodeConfigWriterOpts,
): McpStateMap {
  const path = getConfigPath(opts)
  const states: McpStateMap = new Map()
  if (!existsSync(path)) return states
  let parsed: OpencodeJson
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return states
  }
  const mcp = parsed.mcp
  if (!mcp || typeof mcp !== "object") return states
  for (const [name, entry] of Object.entries(mcp)) {
    if (entry && typeof entry === "object" && "enabled" in entry) {
      states.set(name, entry.enabled === false ? "disabled" : "enabled")
    }
  }
  return states
}

export function applyMcpStateChanges(
  opts: OpencodeConfigWriterOpts,
  changes: ReadonlyArray<{ name: string; to: McpEnabledState }>,
): { written: boolean; path: string } {
  const path = getConfigPath(opts)
  const existed = existsSync(path)
  const base: OpencodeJson = existed
    ? safeReadJson(path)
    : { $schema: SCHEMA_URL, mcp: {} }
  const next: OpencodeJson = { ...base, mcp: { ...(base.mcp ?? {}) } }
  let mutated = false
  for (const change of changes) {
    const existing = next.mcp![change.name] ?? {}
    const wantsEnabled = change.to === "enabled"
    if (!wantsEnabled || existing.enabled === false) {
      const merged: McpEntry = { ...existing, enabled: wantsEnabled }
      next.mcp![change.name] = merged
      mutated = true
    } else if ("enabled" in existing && existing.enabled !== wantsEnabled) {
      next.mcp![change.name] = { ...existing, enabled: wantsEnabled }
      mutated = true
    }
  }
  if (!mutated) return { written: false, path }
  writeAtomic(path, JSON.stringify(next, null, 2) + "\n")
  return { written: true, path }
}

function safeReadJson(path: string): OpencodeJson {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return { $schema: SCHEMA_URL, mcp: {} }
  }
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp.${Date.now()}.${process.pid}`
  writeFileSync(tmp, content, { mode: 0o644 })
  renameSync(tmp, path)
}
