/**
 * The `omo daemon` command-line contract: its exit codes and the small argv helpers
 * `runDaemonCommand` uses. Moved verbatim out of `daemon.js`.
 */

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

export function blockingPause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}
