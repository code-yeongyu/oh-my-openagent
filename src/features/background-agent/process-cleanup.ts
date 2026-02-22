import { log } from "../../shared"

type ProcessCleanupEvent = NodeJS.Signals | "beforeExit" | "exit"

function registerProcessSignal(
  signal: ProcessCleanupEvent,
  handler: () => void,
  exitAfter: boolean
): () => void {
  const listener = () => {
    handler()
    if (exitAfter) {
      process.exitCode = 0
      setTimeout(() => process.exit(), 6000).unref()
    }
  }
  process.on(signal, listener)
  return listener
}

interface CleanupTarget {
  shutdown(): void
}

const cleanupManagers = new Set<CleanupTarget>()
let cleanupRegistered = false
const cleanupHandlers = new Map<ProcessCleanupEvent, () => void>()

export function registerManagerForCleanup(manager: CleanupTarget): void {
  cleanupManagers.add(manager)

  if (cleanupRegistered) return
  cleanupRegistered = true

  const cleanupAll = () => {
    for (const m of cleanupManagers) {
      try {
        m.shutdown()
      } catch (error) {
        log("[background-agent] Error during shutdown cleanup:", error)
      }
    }
  }

  const registerSignal = (signal: ProcessCleanupEvent, exitAfter: boolean): void => {
    const listener = registerProcessSignal(signal, cleanupAll, exitAfter)
    cleanupHandlers.set(signal, listener)
  }

  registerSignal("SIGINT", true)
  registerSignal("SIGTERM", true)
  if (process.platform === "win32") {
    registerSignal("SIGBREAK", true)
  }
  registerSignal("beforeExit", false)
  registerSignal("exit", false)
}

export function unregisterManagerForCleanup(manager: CleanupTarget): void {
  cleanupManagers.delete(manager)

  if (cleanupManagers.size > 0) return

  for (const [signal, listener] of cleanupHandlers.entries()) {
    process.off(signal, listener)
  }
  cleanupHandlers.clear()
  cleanupRegistered = false
}

/** @internal — test-only reset for module-level singleton state */
export function _resetForTesting(): void {
  for (const manager of [...cleanupManagers]) {
    cleanupManagers.delete(manager)
  }
  for (const [signal, listener] of cleanupHandlers.entries()) {
    process.off(signal, listener)
  }
  cleanupHandlers.clear()
  cleanupRegistered = false
}
