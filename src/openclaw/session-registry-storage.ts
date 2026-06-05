import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname } from "path"
import { REGISTRY_PATH, SECURE_FILE_MODE } from "./session-registry-paths"
import type { SessionMapping } from "./session-registry-types"

function isSessionMapping(value: unknown): value is SessionMapping {
  if (typeof value !== "object" || value === null) return false
  if (!("sessionId" in value) || typeof value.sessionId !== "string") return false
  if (!("tmuxSession" in value) || typeof value.tmuxSession !== "string") return false
  if (!("tmuxPaneId" in value) || typeof value.tmuxPaneId !== "string") return false
  if (!("projectPath" in value) || typeof value.projectPath !== "string") return false
  if (!("platform" in value) || typeof value.platform !== "string") return false
  if (!("messageId" in value) || typeof value.messageId !== "string") return false
  if (!("createdAt" in value) || typeof value.createdAt !== "string") return false
  return true
}

export function ensureRegistryDir(): void {
  const registryDir = dirname(REGISTRY_PATH)
  if (!existsSync(registryDir)) {
    mkdirSync(registryDir, { recursive: true, mode: 0o700 })
  }
}

export function readAllMappingsUnsafe(): SessionMapping[] {
  if (!existsSync(REGISTRY_PATH)) return []
  try {
    const content = readFileSync(REGISTRY_PATH, "utf-8")
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          const parsed: unknown = JSON.parse(line)
          return isSessionMapping(parsed) ? parsed : null
        } catch (error) {
          if (error instanceof SyntaxError) return null
          return null
        }
      })
      .filter((mapping): mapping is SessionMapping => mapping !== null)
  } catch (error) {
    if (error instanceof Error) return []
    return []
  }
}

export function rewriteRegistryUnsafe(mappings: readonly SessionMapping[]): void {
  ensureRegistryDir()
  if (mappings.length === 0) {
    writeFileSync(REGISTRY_PATH, "", { mode: SECURE_FILE_MODE })
    return
  }
  const content = mappings.map((mapping) => JSON.stringify(mapping)).join("\n") + "\n"
  writeFileSync(REGISTRY_PATH, content, { mode: SECURE_FILE_MODE })
}
