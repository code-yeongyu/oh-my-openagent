import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
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
  } catch {
    // Best-effort: if the parent can't be created (read-only volume, missing
    // permission), the user will see a clear ENOENT at first write and can
    // override OMO_MEMORY_FILE_PATH. Don't fail plugin startup over it.
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
