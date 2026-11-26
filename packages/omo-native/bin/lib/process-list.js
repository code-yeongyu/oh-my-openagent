// @ts-check
import { spawnSync } from "node:child_process"

/** @typedef {import("./diagnostics-contract").ProcessEntry} ProcessEntry */
/** @typedef {import("./diagnostics-contract").ProcessPort} ProcessPort */

// -ww: an unlimited width, so `args` is never cut at the terminal width (BSD/macOS `ps` truncates).
const PS_ARGV = ["-ww", "-axo", "pid=,ppid=,etime=,tty=,args="]

/** @param {string} stdout `ps`'s own answer @returns {ProcessEntry[]} */
function parseProcessTable(stdout) {
  const entries = []
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    entries.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      elapsed: /** @type {string} */ (match[3]),
      tty: /** @type {string} */ (match[4]),
      command: /** @type {string} */ (match[5]),
    })
  }
  return entries
}

/**
 * Reads the live process table. `ps` is the portable answer on macOS and Linux alike, and reading
 * it can never be a reason for diagnostics to fail, so an unavailable or unparsable listing is an
 * empty list.
 * @returns {ProcessEntry[]}
 */
export function listProcesses() {
  if (process.platform === "win32") return []
  const listed = spawnSync("ps", PS_ARGV, { encoding: "utf8" })
  if (listed.status !== 0 || typeof listed.stdout !== "string") return []
  return parseProcessTable(listed.stdout)
}

/**
 * The process table and the signal a reap needs, over the low-level process port when one is given (a conformance run's
 * fake), else the host's own `ps` and `process.kill`. A function-level `list` / `kill` (a unit test's) wins over both.
 *
 * Trust boundary (design ruling on #14959): the port is part of the trusted base, like the code that runs `ps` today. The
 * core decides ownership from what it reports and cannot verify that independently, so the guarantee is where a port can
 * come from: (1) only the process that constructs a root supplies it, through createDiagnosticsLoader, never a call's
 * input; (2) that process runs as the OS user and can already signal the user's processes, so a lying port gives it
 * nothing new; (3) a session never constructs its own root: the SDK the engine plugin provisions to sessions has no
 * launcher-side cores, so no process port (omo-sdk/session-process-port.test.ts); (4) the public entry's options do not
 * expose it: the port is an internal and test seam of the loader.
 * @param {{ list?: () => readonly ProcessEntry[], kill?: (pid: number, signal: NodeJS.Signals) => void, process?: ProcessPort }} ports
 */
export function processAccess(ports) {
  const port = ports.process
  return {
    /** @returns {Promise<readonly ProcessEntry[]>} */
    list: async () => {
      if (ports.list !== undefined) return ports.list()
      if (port === undefined) return listProcesses()
      const answer = await port.spawn("ps", PS_ARGV)
      return answer.exitCode === 0 ? parseProcessTable(answer.stdout) : []
    },
    /** @param {number} pid @param {NodeJS.Signals} signal */
    kill: async (pid, signal) => {
      if (ports.kill !== undefined) return ports.kill(pid, signal)
      if (port === undefined) return void process.kill(pid, signal)
      await port.signal(pid, signal)
    },
  }
}
