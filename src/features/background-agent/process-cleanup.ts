import { log } from "../../shared"

type ProcessCleanupSignal = NodeJS.Signals | "beforeExit" | "exit"
type ProcessCleanupErrorEvent = "uncaughtException" | "unhandledRejection"

/**
 * When set to a truthy value (1/true/yes/on), suppresses the global
 * uncaughtException / unhandledRejection handlers that force-exit the host
 * process. Use this when the plugin is installed but background-agent tasks
 * are not actively in use, to avoid OpenCode dying on transient streaming
 * errors propagated as unhandled rejections (see issue #3856).
 *
 * Signal handlers (SIGINT/SIGTERM/SIGBREAK/beforeExit/exit) remain registered
 * because they are needed for graceful shutdown of any in-flight cleanup
 * targets that were registered before the user noticed the issue.
 */
const PROCESS_CLEANUP_DISABLE_ENV = "OMO_DISABLE_PROCESS_CLEANUP"
const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"])

function isProcessCleanupErrorHandlersDisabled(): boolean {
  const raw = process.env[PROCESS_CLEANUP_DISABLE_ENV]
  if (!raw) return false
  return TRUTHY_ENV_VALUES.has(raw.trim().toLowerCase())
}

/** @internal test-only seam: prevents process.exitCode from contaminating bun test runner */
let _scheduleForcedExitEnabled = true

/** @internal test-only */
export function __disableScheduledForcedExitForTesting(): void {
  _scheduleForcedExitEnabled = false
}

/** @internal test-only */
export function __enableScheduledForcedExitForTesting(): void {
  _scheduleForcedExitEnabled = true
}

function scheduleForcedExit(
  cleanupResult: void | Promise<void>,
  exitCode: number,
  exitAfterCleanup = false,
): void {
  if (!_scheduleForcedExitEnabled) return
  process.exitCode = exitCode
  const exitTimeout = setTimeout(() => process.exit(), 6000)
  void Promise.resolve(cleanupResult).finally(() => {
    clearTimeout(exitTimeout)
    if (exitAfterCleanup) {
      process.exit(exitCode)
    }
  })
}

function registerProcessSignal(
  signal: ProcessCleanupSignal,
  handler: () => void | Promise<void>,
  exitAfter: boolean
): () => void {
  const listener = () => {
    const cleanupResult = handler()
    if (exitAfter) {
      scheduleForcedExit(cleanupResult, 0, true)
    }
  }
  process.on(signal, listener)
  return listener
}

function registerErrorEvent(
  signal: ProcessCleanupErrorEvent,
  handler: (error: unknown) => void | Promise<void>
): (error: unknown) => void {
  const listener = (error: unknown) => {
    // Detach before running the body so a re-emit from inside log()/handler()
    // (e.g. EPIPE while closing a broken pipe during shutdown) cannot recurse.
    // Prior behavior: the listener re-entered itself, re-logged, re-ran cleanup,
    // and threw EPIPE again — an unbounded loop that filled disks with 100+ GB
    // of log lines in minutes before the 6 s forced-exit timer could fire.
    process.off(signal, listener)
    log(`[background-agent] ${signal} received during shutdown cleanup:`, error)
    scheduleForcedExit(handler(error), 1, true)
  }
  process.on(signal, listener)
  return listener
}

interface CleanupTarget {
  shutdown(): void | Promise<void>
}

const cleanupManagers = new Set<CleanupTarget>()
let cleanupRegistered = false
const cleanupSignalHandlers = new Map<ProcessCleanupSignal, () => void>()
const cleanupErrorHandlers = new Map<ProcessCleanupErrorEvent, (error: unknown) => void>()

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

  const registerSignal = (signal: ProcessCleanupSignal, exitAfter: boolean): void => {
    const listener = registerProcessSignal(signal, cleanupAll, exitAfter)
    cleanupSignalHandlers.set(signal, listener)
  }

  registerSignal("SIGINT", true)
  registerSignal("SIGTERM", true)
  if (process.platform === "win32") {
    registerSignal("SIGBREAK", true)
  }
  registerSignal("beforeExit", false)
  registerSignal("exit", false)

  if (isProcessCleanupErrorHandlersDisabled()) {
    log(
      `[background-agent] ${PROCESS_CLEANUP_DISABLE_ENV} is set; skipping global uncaughtException/unhandledRejection handler registration. `
        + "Signal handlers (SIGINT/SIGTERM/beforeExit/exit) remain active.",
    )
    return
  }

  cleanupErrorHandlers.set("uncaughtException", registerErrorEvent("uncaughtException", cleanupAll))
  cleanupErrorHandlers.set("unhandledRejection", registerErrorEvent("unhandledRejection", cleanupAll))
}

export function unregisterManagerForCleanup(manager: CleanupTarget): void {
  cleanupManagers.delete(manager)

  if (cleanupManagers.size > 0) return

  for (const [signal, listener] of cleanupSignalHandlers.entries()) {
    process.off(signal, listener)
  }
  for (const [signal, listener] of cleanupErrorHandlers.entries()) {
    process.off(signal, listener)
  }
  cleanupSignalHandlers.clear()
  cleanupErrorHandlers.clear()
  cleanupRegistered = false
}

/** @internal - test-only reset for module-level singleton state */
export function _resetForTesting(): void {
  for (const manager of [...cleanupManagers]) {
    cleanupManagers.delete(manager)
  }
  for (const [signal, listener] of cleanupSignalHandlers.entries()) {
    process.off(signal, listener)
  }
  for (const [signal, listener] of cleanupErrorHandlers.entries()) {
    process.off(signal, listener)
  }
  cleanupSignalHandlers.clear()
  cleanupErrorHandlers.clear()
  cleanupRegistered = false
}
