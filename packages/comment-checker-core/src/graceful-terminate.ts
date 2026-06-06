// Duplicated from src/shared/signals/graceful-escalation.ts because @oh-my-opencode/comment-checker-core
// has a separate tsconfig and cannot cross-import from src/ without cross-contaminating the package's
// dist artifact. Type signature is narrower (SpawnProcess.kill accepts only "SIGTERM" | "SIGKILL")
// so the helper takes SpawnProcess rather than the shared TerminableProcess.
import type { SpawnProcess } from "./types"

const DEFAULT_GRACE_PERIOD_MS = 3000

export interface GracefulTerminateOptions {
  gracePeriodMs?: number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

export function gracefulTerminate(proc: SpawnProcess, options: GracefulTerminateOptions = {}): void {
  const grace = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout

  try {
    proc.kill("SIGTERM")
  } catch {
    return
  }

  const killTimer = setTimer(() => {
    try {
      proc.kill("SIGKILL")
    } catch {}
  }, grace)

  void proc.exited?.then(() => clearTimer(killTimer)).catch(() => {})
}
