import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { CodeGraphContextConfig } from "../config/schema/code-graph-context"

export type LocalMcpConfig = {
  type: "local"
  command: string[]
  environment: Record<string, string>
  enabled: boolean
}

const COMMON_BINARY_LOCATIONS = [
  join(homedir(), ".local", "bin", "cgc"),
  "/usr/local/bin/cgc",
  "/usr/bin/cgc",
]

function findCgcBinary(overridePath?: string): string | undefined {
  if (overridePath) {
    return existsSync(overridePath) ? overridePath : undefined
  }

  for (const location of COMMON_BINARY_LOCATIONS) {
    if (existsSync(location)) return location
  }

  return undefined
}

function buildDefaultEnvironment(): Record<string, string> {
  const cgcDataDir = join(homedir(), ".codegraphcontext")

  return {
    DEFAULT_DATABASE: "falkordb",
    FALKORDB_PATH: join(cgcDataDir, "falkordb.db"),
    FALKORDB_SOCKET_PATH: join(cgcDataDir, "falkordb.sock"),
    INDEX_VARIABLES: "true",
    ALLOW_DB_DELETION: "false",
    DEBUG_LOGS: "false",
    ENABLE_APP_LOGS: "CRITICAL",
    LIBRARY_LOG_LEVEL: "WARNING",
    LOG_FILE_PATH: join(cgcDataDir, "logs", "cgc.log"),
    MAX_FILE_SIZE_MB: "10",
    IGNORE_TEST_FILES: "false",
    IGNORE_HIDDEN_FILES: "true",
    ENABLE_AUTO_WATCH: "false",
    COMPLEXITY_THRESHOLD: "10",
    MAX_DEPTH: "unlimited",
    PARALLEL_WORKERS: "4",
    CACHE_ENABLED: "true",
    IGNORE_DIRS:
      "node_modules,venv,.venv,env,.env,dist,build,target,out,.git,.idea,.vscode,__pycache__",
    INDEX_SOURCE: "true",
    SCIP_INDEXER: "false",
    SCIP_LANGUAGES: "python,typescript,go,rust,java",
    SKIP_EXTERNAL_RESOLUTION: "false",
  }
}

export function createCodeGraphContextConfig(
  config?: CodeGraphContextConfig,
): LocalMcpConfig | undefined {
  if (!config?.enabled) return undefined

  const binaryPath = findCgcBinary(config.binary_path)
  if (!binaryPath) return undefined

  return {
    type: "local",
    command: [binaryPath, "mcp", "start"],
    environment: buildDefaultEnvironment(),
    enabled: true,
  }
}
