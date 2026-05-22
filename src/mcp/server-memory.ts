import { homedir } from "node:os"
import { join } from "node:path"
import type { LocalMcpConfig } from "./lsp"

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

export function createServerMemoryConfig(): LocalMcpConfig {
  return {
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    enabled: true,
    environment: {
      MEMORY_FILE_PATH: process.env["OMO_MEMORY_FILE_PATH"] ?? getDefaultMemoryFilePath(),
    },
  }
}
