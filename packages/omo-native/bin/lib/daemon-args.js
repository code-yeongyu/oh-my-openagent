/**
 * The `omo daemon` command-line contract: the flags this wrapper consumes, its exit codes, and the
 * small argv helpers `runDaemonCommand` uses. Moved verbatim out of `daemon.js`.
 */

/** Flags this wrapper consumes itself; anything else after `attach` belongs to the launch. */
const DAEMON_FLAGS = new Set([
  "--json",
  "--no-upgrade",
  "--persistent",
  "--foreground",
  "--include-workers",
  "--drain",
  "--all",
  "--wait",
  "--dry-run",
  "--allow-missing-index",
  "--prune-store-index",
])
const DAEMON_VALUE_FLAGS = new Set(["--store", "--timeout"])

/** A named code per outcome, so a script never has to parse the message to know what happened. */
export const DAEMON_EXIT = {
  ok: 0,
  usage: 2,
  notRunning: 3,
  unsupported: 4,
  engineRefused: 5,
}

export function readTimeoutSeconds(args) {
  const index = args.indexOf("--timeout")
  if (index === -1) return 600
  const value = Number(args[index + 1])
  return Number.isFinite(value) && value >= 0 ? value : 600
}

export function attachLaunchArgs(args) {
  const launchArgs = []
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    if (DAEMON_FLAGS.has(argument)) continue
    if (DAEMON_VALUE_FLAGS.has(argument)) {
      index += 1
      continue
    }
    launchArgs.push(argument)
  }
  return launchArgs
}

export function blockingPause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}
