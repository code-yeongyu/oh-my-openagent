import { log } from "../../shared/logger"
import { resetWarningState } from "./degradation-warnings"
import { attemptRecoverySync, type McbOperationExecutor } from "./recovery-sync"
import { getMcbAvailability } from "./availability"

export function handleMcbSessionCreated(projectDir: string, executor: McbOperationExecutor): void {
  resetWarningState()

  const status = getMcbAvailability()
  if (!status.available) {
    return
  }

  attemptRecoverySync(projectDir, executor).catch((error) => {
    log("[mcb] Recovery sync failed on session.created", error instanceof Error ? error.message : String(error))
  })
}
