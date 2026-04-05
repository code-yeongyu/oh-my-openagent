import { log } from "../../shared"

type ProcessCleanupEvent = NodeJS.Signals | "beforeExit" | "exit"

function registerProcessSignal(
  signal: ProcessCleanupEvent,
  handler: () => void | Promise<void>,
  exitAfter: boolean
): () => void {
  const listener = () => {
    const cleanupResult = handler()
    if (exitAfter) {
      process.exitCode = 0
      const exitTimeout = setTimeout(() => process.exit(), 6000)
      void Promise.resolve(cleanupResult).finally(() => {
        clearTimeout(exitTimeout)
      })
    }
  }
  process.on(signal, listener)
  return listener
}

interface CleanupTarget {
  shutdown(): void | Promise<void>
}

const cleanupManagers = new Set<CleanupTarget>()
let cleanupRegistered = false
const cleanupHandlers = new Map<ProcessCleanupEvent, () => void>()

export function registerManagerForCleanup(manager: CleanupTarget): void {
  cleanupManagers.add(manager)

  if (cleanupRegistered) return
  cleanupRegistered = true

  let cleanupPromise: Promise<void> | undefined

  const cleanupAll = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise
    const promises: Promise<void>[] = []
    for (const m of cleanupManagers) {
      try {
        promises.push(
          Promise.resolve(m.shutdown()).catch((error) => {
            log("[background-agent] Error during async shutdown cleanup:", error)
          })
        )
      } catch (error) {
        log("[background-agent] Error during shutdown cleanup:", error)
      }
    }
    cleanupPromise = Promise.allSettled(promises).then(() => {})
    cleanupPromise.then(() => {
      log("[background-agent] All shutdown cleanup completed")
    })

    return cleanupPromise
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

/** @internal - test-only reset for module-level singleton state */
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
