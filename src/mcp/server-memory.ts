import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { log } from "../shared/logger"
import type { LocalMcpConfig } from "./lsp"
import { resolveRuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable"

// Default storage location for the persistent knowledge-graph memory. We pin
// this to the user's OpenCode cache directory rather than `process.cwd()` so
// memories survive switching projects. Users can override with the
// `OMO_MEMORY_FILE_PATH` env var or by disabling this MCP entirely and adding
// their own server-memory config to opencode.json.
function getDefaultMemoryFilePath(): string {
  const xdgCache = process.env["XDG_CACHE_HOME"]
  const base = xdgCache ? join(xdgCache, "opencode") : join(homedir(), ".cache", "opencode")
  return join(base, "oh-my-openagent-memory.json")
}

function readEnvMemoryFilePath(): string | undefined {
  const raw = process.env["OMO_MEMORY_FILE_PATH"]
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function ensureParentDirectory(filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
  } catch (error) {
    // Best-effort: a read-only volume / EACCES shouldn't fail plugin startup.
    // Log so the user has a breadcrumb when the memory server later trips on
    // ENOENT — they can either grant permission or override OMO_MEMORY_FILE_PATH.
    log("[mcp/memory] Failed to ensure memory file parent directory", {
      directory: dirname(filePath),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

type ServerMemoryOptions = {
  readonly resolveExecutable?: RuntimeExecutableResolver
}

export function createServerMemoryConfig(options: ServerMemoryOptions = {}): LocalMcpConfig {
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable
  const npx = resolveExecutable("npx")
  const filePath = readEnvMemoryFilePath() ?? getDefaultMemoryFilePath()
  ensureParentDirectory(filePath)
  return {
    type: "local",
    command: [npx.command, "-y", "@modelcontextprotocol/server-memory"],
    enabled: npx.available,
    environment: {
      MEMORY_FILE_PATH: filePath,
    },
  }
}
