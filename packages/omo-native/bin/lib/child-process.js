import { spawn } from "node:child_process"

// Signals a terminal or supervisor sends to the launcher, and what the launcher does with each.
// SIGTERM and SIGHUP reach one process, so the child has to be told. SIGINT is delivered to the
// whole foreground process group by the tty, so the child already has it and forwarding would
// interrupt it twice - the launcher only waits for the child to finish reacting to its own copy.
const HANDLED_SIGNALS = [
  ["SIGTERM", true],
  ["SIGHUP", true],
  ["SIGINT", false],
]

// The engine's own shutdown drains in ~1.5-2.5s. Ten seconds is the ceiling before the launcher
// stops waiting on a child that is not going to leave and reports the death it was asked for.
const DEFAULT_GRACE_MS = 10_000

function graceMs(env) {
  const configured = Number(env.OMO_SIGNAL_GRACE_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_GRACE_MS
}

export function propagateResult(result) {
  if (result.error) throw result.error
  if (result.signal) {
    process.kill(process.pid, result.signal)
    return
  }
  process.exitCode = result.status ?? 1
}

/**
 * Runs a child to completion without blocking this process's event loop, so the launcher can still
 * answer signals while the engine is in the foreground.
 *
 * `spawnSync` cannot do this: no JS handler runs while it blocks, so a SIGTERM'd launcher dies
 * instantly and leaves the engine reparented to init. Here the same signals are forwarded to the
 * child, the child is given a bounded grace window to shut down on its own terms, and only then is
 * the signal re-raised on this process.
 *
 * Windows has no POSIX signals: `process.on("SIGTERM")` never fires there and `subprocess.kill`
 * would terminate the child abruptly, so nothing is forwarded and the wait is the whole behavior.
 */
export function runChild(command, args, options = {}) {
  const env = options.env ?? process.env
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      ...options,
    })

    let settled = false
    let graceTimer
    const listeners = []

    const cleanup = () => {
      for (const [signal, listener] of listeners) process.off(signal, listener)
      if (graceTimer) clearTimeout(graceTimer)
    }

    const settle = (outcome) => {
      if (settled) return
      settled = true
      cleanup()
      outcome()
    }

    if (process.platform !== "win32") {
      for (const [signal, forward] of HANDLED_SIGNALS) {
        const listener = () => {
          if (forward) {
            try {
              child.kill(signal)
            } catch {
              // The child is already gone; its exit event carries the real answer.
            }
          }
          // A child that swallows the signal must not keep the launcher alive forever: after the
          // grace window this process dies of the signal it was sent, exactly as it would have
          // without a handler installed.
          if (graceTimer) return
          graceTimer = setTimeout(() => {
            settle(() => {
              // Every listener for this signal has to go, not just this module's: the re-raise only
              // terminates the process when nothing is left to handle it.
              process.removeAllListeners(signal)
              process.kill(process.pid, signal)
            })
          }, graceMs(env))
        }
        listeners.push([signal, listener])
        process.on(signal, listener)
      }
    }

    child.on("error", (error) => settle(() => reject(error)))
    // A child that died of the forwarded signal needs no special case: `propagateResult` turns a
    // signaled result into this process dying by the same signal, which is exactly right.
    child.on("exit", (status, signal) => settle(() => resolve({ status, signal })))
  })
}

export async function spawnNode(scriptPath, args, options = {}) {
  const result = await runChild(process.execPath, [scriptPath, ...args], options)
  propagateResult(result)
}
