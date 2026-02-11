import * as logger from "../../shared/logger"
import type { McbToolAvailability } from "./types"

const emittedWarnings = new Set<keyof McbToolAvailability>()

const capabilityByTool: Record<keyof McbToolAvailability, string> = {
  memory: "learning storage, artifact ingestion, observation persistence",
  search: "semantic code search, memory search, context search",
  index: "codebase indexing, embedding generation",
  validate: "code quality validation, rule enforcement",
  vcs: "git-aware context, branch comparison, impact analysis",
  session: "session lifecycle tracking, activity logging",
}

export function emitMcbDegradationWarning(tool: keyof McbToolAvailability): void {
  if (emittedWarnings.has(tool)) {
    return
  }

  const capabilities = capabilityByTool[tool]
  const message = `[mcb] MCB tool '${tool}' is unavailable. Affected capabilities: ${capabilities}. Operations will be queued for sync when MCB recovers.`
  emittedWarnings.add(tool)
  console.warn(message)
  logger.log(message)
}

export function resetWarningState(): void {
  emittedWarnings.clear()
}
