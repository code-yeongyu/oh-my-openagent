import {
  emptyProjectLocalCodexCleanupResult,
  repairNearestProjectLocalCodexArtifacts,
} from "./codex-project-local-cleanup"
import type { ProjectLocalCodexCleanupResult } from "./codex-project-local-cleanup"

export async function repairProjectLocalCodexArtifactsBestEffort(input: {
  readonly startDirectory: string
  readonly codexHome: string
  readonly now?: () => Date
  readonly log: (message: string) => void
}): Promise<ProjectLocalCodexCleanupResult> {
  try {
    return await repairNearestProjectLocalCodexArtifacts({
      startDirectory: input.startDirectory,
      codexHome: input.codexHome,
      now: input.now,
    })
  } catch (error) {
    input.log(`Skipped project-local Codex cleanup: ${formatUnknownError(error)}`)
    return emptyProjectLocalCodexCleanupResult()
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
