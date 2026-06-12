import { log } from "../../shared"

type ProcessCleanupSignal = NodeJS.Signals | "beforeExit" | "exit"
type ProcessCleanupErrorEvent = "uncaughtException" | "unhandledRejection"

/**
 * When set to a truthy value (1/true/yes/on), skips registering the global
 * uncaughtException / unhandledRejection log listeners entirely.
 *
 * The listeners are log-only by default and no longer force-exit the host
 * (originally a fix for issue #3856 that previously turned every transient
 * streaming rejection into a `process.exit(1)`; reverified during the ulw
 * `/init-deep` hang investigation that motivated the log-only rewrite).
 * Setting this env var still makes the plugin silent on those events; leave
 * it unset whenever you want the diagnostic line and the `name/message/stack`
 * payload from `describeProcessCleanupError`.
 *
 * Signal handlers (SIGINT/SIGTERM/SIGBREAK/beforeExit/exit) remain registered
 * because they are the real shutdown path and run `cleanupAll()` before the
 * host actually terminates.
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

/**
 * Tracks whether the host is in a shutdown window. Set by the SIGINT /
 * SIGTERM / SIGBREAK / beforeExit listeners; consulted by
 * isHarmlessShutdownError so that EPIPE / ECONNRESET errors emitted during
 * NORMAL runtime still log (a mid-stream provider socket reset is a real
 * diagnostic signal — see `process-cleanup.ts` history at lines 107/118),
 * while shutdown-time bursts (issue #3772) stay silent.
 */
let _shutdownInProgress = false

function markShutdownStarted(): void {
  _shutdownInProgress = true
}

/** @internal test-only seam */
export function __isShutdownInProgressForTesting(): boolean {
  return _shutdownInProgress
}

/** @internal test-only seam */
export function __setShutdownInProgressForTesting(value: boolean): void {
  _shutdownInProgress = value
}

function registerProcessSignal(
  signal: ProcessCleanupSignal,
  handler: () => void | Promise<void>,
  exitAfter: boolean
): () => void {
  const listener = () => {
    markShutdownStarted()
    const cleanupResult = handler()
    if (exitAfter) {
      scheduleForcedExit(cleanupResult, 0, true)
    }
  }
  process.on(signal, listener)
  return listener
}

/** @internal test-only seam: exposes the error normalizer used by registerErrorEvent. */
export function describeProcessCleanupError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  if (typeof error === "object" && error !== null) {
    try {
      const json = JSON.stringify(error)
      if (json !== "{}") return { raw: json }
    } catch (stringifyError) {
      if (stringifyError instanceof Error) return { raw: String(error) }
      return { raw: String(error) }
    }
    return { raw: String(error) }
  }
  return { raw: String(error) }
}

/**
 * Harmless shutdown errno codes raised when the host detaches stdio before our
 * background worker finishes draining its writes. Logging them once per event
 * was historically fine, but during shutdown loops (issue #3772) Node can emit
 * these millions of times per second — even one log line per event will fill
 * disk with hundreds of GB before the forced-exit timer fires.
 *
 * We only treat a `code: "EPIPE" | "ECONNRESET"` as harmless when EITHER of
 * the following is true:
 *
 *   1. The errno object identifies a stdio write (`syscall === "write"` AND
 *      `fd` is 1 or 2). This matches Node's `SystemError` shape for broken
 *      stdout/stderr pipes and never matches a mid-stream provider socket
 *      reset (which has no `fd` and a non-`write` syscall).
 *   2. The host is already inside a shutdown window — `markShutdownStarted()`
 *      has fired from SIGINT / SIGTERM / SIGBREAK / beforeExit. During real
 *      shutdown the original #3772 burst can come from non-stdio sockets too
 *      (MCP / provider teardown), and silencing them then is still safe.
 *
 * Normal-runtime EPIPE / ECONNRESET on non-stdio (mid-stream provider socket
 * resets, MCP reconnect failures) must still log — see the in-file diagnostic
 * commentary on registerErrorEvent below.
 */
const HARMLESS_SHUTDOWN_ERRNO_CODES = new Set(["EPIPE", "ECONNRESET"])
const STDIO_WRITE_FDS = new Set([1, 2])

function isStdioWriteError(error: object): boolean {
  const syscall = (error as { syscall?: unknown }).syscall
  const fd = (error as { fd?: unknown }).fd
  return syscall === "write" && typeof fd === "number" && STDIO_WRITE_FDS.has(fd)
}

/** @internal test-only seam: exposes the harmless-error filter used by registerErrorEvent. */
export function isHarmlessShutdownError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = (error as { code?: unknown }).code
  if (typeof code !== "string") return false
  if (!HARMLESS_SHUTDOWN_ERRNO_CODES.has(code)) return false
  if (isStdioWriteError(error)) return true
  return _shutdownInProgress
}

function registerErrorEvent(
  signal: ProcessCleanupErrorEvent,
): (error: unknown) => void {
  // Log-only listener. We deliberately DO NOT run cleanup or force-exit on
  // transient errors.
  //
  // History: earlier this listener invoked `scheduleForcedExit(handler(error),
  // 1, true)` so every unhandled promise rejection ran the registered cleanup
  // (BackgroundManager shutdown, tmux pane closure, team-mode teardown) and
  // then `process.exit(1)`'d the host. With OpenCode bundled under Bun, our
  // listener already suppresses the default crash behavior, so the host was
  // surviving the error itself but we were tearing it down ourselves. During
  // heavy slash commands like `/init-deep` running in ulw mode that turned a
  // single transient streaming error (e.g. a mid-stream socket reset or
  // `session.processor` Aborted-process condition) into a frozen TUI for the
  // user.
  //
  // The signal handlers (SIGINT / SIGTERM / SIGBREAK / beforeExit / exit)
  // still cover real shutdown paths and run `cleanupAll()` before process
  // termination. `exit` in particular fires for every controlled exit
  // regardless of cause, so cleanup is not skipped when the host genuinely
  // dies.
  //
  // Keep the listener installed after logging. Desktop sidecars can emit more
  // than one transient error during MCP startup or provider reconnects; if we
  // detach after the first event, the second uncaught exception falls through
  // to Node's default process termination path and reproduces the exit-code-1
  // crash from #4128. A local re-entry guard still prevents `log()` failures
  // (for example EPIPE while writing during shutdown) from recursing into the
  // 100+ GB log explosion that #3856-era regressions caused.
  let logging = false
  const listener = (error: unknown) => {
    if (logging) return
    // Drop harmless shutdown EPIPE/ECONNRESET without logging. During real
    // shutdown Node can emit thousands of these per second once stdio closes;
    // even one log line per event compounds to multi-GB log files
    // (issue #3772). The signal handlers below still run the actual cleanup
    // path on the genuine shutdown signals.
    if (isHarmlessShutdownError(error)) return
    logging = true
    log(
      `[background-agent] ${signal} observed; keeping host alive and skipping cleanup (signal handlers run on real shutdown)`,
      describeProcessCleanupError(error),
    )
    logging = false
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

export function __getProcessCleanupSignalListenerForTesting(
  signal: ProcessCleanupSignal,
): (() => void) | undefined {
  return cleanupSignalHandlers.get(signal)
}

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
            // Skip harmless stdio EPIPE during shutdown — see issue #3772.
            if (isHarmlessShutdownError(error)) return
            log("[background-agent] Error during async shutdown cleanup:", error)
          })
        )
      } catch (error) {
        const harmless = isHarmlessShutdownError(error)
        if (error instanceof Error) {
          if (harmless) continue
        } else if (harmless) {
          continue
        }
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

  cleanupErrorHandlers.set("uncaughtException", registerErrorEvent("uncaughtException"))
  cleanupErrorHandlers.set("unhandledRejection", registerErrorEvent("unhandledRejection"))
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
  _shutdownInProgress = false
}
